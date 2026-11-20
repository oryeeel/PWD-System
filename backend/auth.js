const session = require('express-session');
const {MongoStore} = require('connect-mongo');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const {rateLimit} = require('express-rate-limit');
const {normalizeEmail,duplicateAccountMessage} = require('./accountEmail');
const {normalizeUsername} = require('./accountUsername');
const {passwordError,PASSWORD_REQUIREMENTS} = require('./passwordPolicy');
const {isAllowedRequestOrigin} = require('./requestOrigin');
const {
  passwordResetDigest,generateOtp,generateResetToken,generateTemporaryPassword,
  isPasswordEmailConfigured,createPasswordResetMailer,createAdminLoginMailer,
} = require('./passwordRecovery');

const IDLE_SESSION_TIMEOUT_MS = 15*60*1000;
const MAX_SESSION_LIFETIME_MS = 8*60*60*1000;

const userSchema = new mongoose.Schema({
  username:{type:String,required:true,unique:true},
  fullname:{type:String,required:true},
  // Existing accounts may have no email; newly created accounts require one
  // through the API and initial administrator setup.
  email:{type:String,trim:true,lowercase:true,validate:{validator:value=>value == null || Boolean(normalizeEmail(value)),message:'Enter a valid email address.'}},
  emailVerifiedAt:{type:Date,default:null,select:false},
  passwordHash:{type:String,required:true,select:false},
  sessionVersion:{type:Number,default:0},
  mustChangePassword:{type:Boolean,default:false},
  resetOtpHash:{type:String,select:false},
  resetOtpExpiresAt:{type:Date,select:false},
  resetOtpAttempts:{type:Number,select:false},
  resetOtpRequestedAt:{type:Date,select:false},
  resetAuthorizationHash:{type:String,select:false},
  resetAuthorizationExpiresAt:{type:Date,select:false},
  role:{type:String,enum:['Admin','Staff'],required:true},
  status:{type:String,enum:['Active','Archived'],default:'Active'},
});
userSchema.index({email:1},{unique:true,partialFilterExpression:{email:{$type:'string'}},collation:{locale:'en',strength:2}});
const User = mongoose.models.User || mongoose.model('User',userSchema);
const publicUser = user => ({id:String(user._id),username:user.username,fullname:user.fullname,email:user.email || '',role:user.role,status:user.status,mustChangePassword:Boolean(user.mustChangePassword)});

function authorize(req,res,next) {
  if (!req.authUser) return res.status(401).json({message:'Please sign in.'});
  const path = req.originalUrl.split('?')[0];
  if ((path.startsWith('/api/users') || path.startsWith('/api/activity-logs')) && req.authUser.role !== 'Admin') {
    return res.status(403).json({message:'Administrator access required.'});
  }
  if (req.authUser.mustChangePassword && !(req.method === 'POST' && path === '/api/auth/change-temporary-password')) {
    return res.status(403).json({message:'Change your temporary password before continuing.'});
  }
  if (!['GET','HEAD','OPTIONS'].includes(req.method) && !path.startsWith('/api/users') && req.authUser.role !== 'Staff') {
    return res.status(403).json({message:'Staff access required.'});
  }
  next();
}

function installAuth(app,env=process.env,dependencies={}) {
  const Users = dependencies.User || User;
  const ActivityLogs = dependencies.ActivityLog;
  const writeActivityLog = dependencies.writeActivityLog || (ActivityLogs ? entry => ActivityLogs.create(entry) : null);
  const sendPasswordResetEmail = dependencies.sendPasswordResetEmail || createPasswordResetMailer(env);
  const sendAdminLoginOtp = dependencies.sendAdminLoginOtp || createAdminLoginMailer(env);
  const emailConfigured = dependencies.emailConfigured ?? isPasswordEmailConfigured(env);
  const now = dependencies.now || (() => new Date());
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32 || !env.APP_ORIGIN) {
    throw new Error('Production requires SESSION_SECRET (at least 32 characters) and APP_ORIGIN.');
  }
  const sameSite = env.SESSION_COOKIE_SAME_SITE || 'lax';
  if (!['lax','strict','none'].includes(sameSite) || (sameSite === 'none' && env.NODE_ENV === 'production' && !env.APP_ORIGIN.startsWith('https://'))) {
    throw new Error('SESSION_COOKIE_SAME_SITE must be lax, strict, or none; cross-site cookies require HTTPS.');
  }
  app.set('trust proxy',1);
  app.use('/api',(req,res,next) => {
    res.setHeader('Cache-Control','no-store');
    if (!['GET','HEAD','OPTIONS'].includes(req.method) && !isAllowedRequestOrigin(req.headers.origin,env.APP_ORIGIN,env)) {
      return res.status(403).json({message:'Request origin is not allowed.'});
    }
    next();
  });
  app.use(session({
    name:'pwd.sid',secret:env.SESSION_SECRET,resave:false,saveUninitialized:false,
    store:dependencies.store || MongoStore.create({mongoUrl:env.MONGODB_URI,collectionName:'sessions'}),
    rolling:true,
    cookie:{httpOnly:true,secure:env.NODE_ENV === 'production',sameSite,maxAge:IDLE_SESSION_TIMEOUT_MS},
  }));
  const loginLimit = rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:'draft-7',legacyHeaders:false,
    message:{message:'Too many sign-in attempts. Please wait 15 minutes before trying again.'}});
  const resetRequestLimit = rateLimit({windowMs:15*60*1000,limit:5,standardHeaders:'draft-7',legacyHeaders:false,
    message:{message:'Too many password recovery requests. Please try again later.'}});
  const resetVerifyLimit = rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:'draft-7',legacyHeaders:false,
    message:{message:'Too many verification attempts. Please try again later.'}});
  const resetCompleteLimit = rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:'draft-7',legacyHeaders:false,
    message:{message:'Too many password reset attempts. Please try again later.'}});
  const mfaVerifyLimit = rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:'draft-7',legacyHeaders:false,
    message:{message:'Too many sign-in verification attempts. Please try again later.'}});
  const mfaResendLimit = rateLimit({windowMs:15*60*1000,limit:5,standardHeaders:'draft-7',legacyHeaders:false,
    message:{message:'Too many verification code requests. Please try again later.'}});

  function destroySession(req,res,status,message,next) {
    req.session.destroy(err => {
      if (err) return next(err);
      res.clearCookie('pwd.sid');
      res.status(status).json({message});
    });
  }

  function establishSession(req,user,res,next) {
    req.session.regenerate(err => {
      if (err) return next(err);
      const timestamp = now().getTime();
      req.session.userId = String(user._id);
      req.session.sessionVersion = user.sessionVersion ?? 0;
      req.session.mustChangePassword = Boolean(user.mustChangePassword);
      req.session.authenticatedAt = timestamp;
      req.session.lastActivityAt = timestamp;
      req.session.cookie.maxAge = IDLE_SESSION_TIMEOUT_MS;
      req.session.save(err => err ? next(err) : res.json(publicUser(user)));
    });
  }

  function emailHint(email) {
    const [local,domain] = String(email || '').split('@');
    return local && domain ? `${local[0]}***@${domain}` : '';
  }

  async function sendAdminCode(email) {
    const otp = generateOtp();
    try {
      await sendAdminLoginOtp(email,otp);
      return otp;
    } catch {
      console.error('Admin sign-in verification email delivery failed.');
      return null;
    }
  }

  app.post('/api/auth/login',loginLimit,async(req,res,next) => {
    try {
      const {password,role} = req.body || {};
      const username = normalizeUsername(req.body?.username);
      if (!username || typeof password !== 'string' || password.length > 128) return res.status(400).json({message:'Enter your username and password.'});
      // Email-shaped usernames are normalized, but email is not an alternate
      // lookup key: each login must identify one registered username.
      const user = await Users.findOne({username,status:'Active'}).select('+passwordHash');
      if (!user || user.role !== role || !await bcrypt.compare(password,user.passwordHash)) return res.status(401).json({message:'Invalid username, password, or role.'});
      if (user.role === 'Admin') {
        if (!emailConfigured || !normalizeEmail(user.email)) {
          return res.status(503).json({message:'Admin sign-in verification is unavailable. Contact the system administrator.'});
        }
        const otp = await sendAdminCode(user.email);
        if (!otp) return res.status(503).json({message:'Could not send the sign-in verification code. Contact the system administrator.'});
        const challengeId = crypto.randomBytes(32).toString('base64url');
        const currentTime = now();
        const pending = {
          userId:String(user._id),
          sessionVersion:user.sessionVersion ?? 0,
          challengeId,
          otpHash:passwordResetDigest(env.SESSION_SECRET,`admin-login\0${user._id}\0${challengeId}\0${otp}`),
          expiresAt:currentTime.getTime()+5*60*1000,
          requestedAt:currentTime.getTime(),
          attempts:0,
        };
        req.session.regenerate(err => {
          if (err) return next(err);
          req.session.pendingAdminMfa = pending;
          req.session.save(err => err ? next(err) : res.json({mfaRequired:true,emailHint:emailHint(user.email)}));
        });
        return;
      }
      establishSession(req,user,res,next);
    } catch(err) {next(err);}
  });
  app.post('/api/auth/login/verify-mfa',mfaVerifyLimit,async(req,res,next) => {
    try {
      const pending = req.session.pendingAdminMfa;
      const currentTime = now();
      if (!pending || pending.expiresAt <= currentTime.getTime() || pending.attempts >= 5) {
        return destroySession(req,res,400,'Invalid or expired sign-in verification code.',next);
      }
      const code = typeof req.body?.code === 'string' ? req.body.code : '';
      const candidate = /^\d{6}$/.test(code)
        ? passwordResetDigest(env.SESSION_SECRET,`admin-login\0${pending.userId}\0${pending.challengeId}\0${code}`)
        : '';
      const matches = candidate.length === pending.otpHash.length &&
        crypto.timingSafeEqual(Buffer.from(candidate),Buffer.from(pending.otpHash));
      if (!matches) {
        pending.attempts += 1;
        if (pending.attempts >= 5) {
          return destroySession(req,res,400,'Invalid or expired sign-in verification code.',next);
        }
        req.session.save(err => err ? next(err) : res.status(400).json({message:'Invalid or expired sign-in verification code.'}));
        return;
      }
      const user = await Users.findOne({_id:pending.userId,status:'Active'});
      if (!user || user.role !== 'Admin' || (user.sessionVersion ?? 0) !== pending.sessionVersion) {
        return destroySession(req,res,401,'Sign-in could not be completed. Please try again.',next);
      }
      establishSession(req,user,res,next);
    } catch(err) {next(err);}
  });
  app.post('/api/auth/login/resend-mfa',mfaResendLimit,async(req,res,next) => {
    try {
      const pending = req.session.pendingAdminMfa;
      const currentTime = now();
      if (!pending || pending.expiresAt <= currentTime.getTime()) {
        return destroySession(req,res,400,'Sign-in verification has expired. Please sign in again.',next);
      }
      if (currentTime.getTime()-pending.requestedAt < 60*1000) {
        return res.status(429).json({message:'Please wait before requesting another verification code.'});
      }
      const user = await Users.findOne({_id:pending.userId,status:'Active'});
      if (!user || user.role !== 'Admin' || (user.sessionVersion ?? 0) !== pending.sessionVersion || !normalizeEmail(user.email)) {
        return destroySession(req,res,401,'Sign-in could not be completed. Please try again.',next);
      }
      const otp = await sendAdminCode(user.email);
      if (!otp) return res.status(503).json({message:'Could not send the sign-in verification code. Contact the system administrator.'});
      const challengeId = crypto.randomBytes(32).toString('base64url');
      pending.challengeId = challengeId;
      pending.otpHash = passwordResetDigest(env.SESSION_SECRET,`admin-login\0${user._id}\0${challengeId}\0${otp}`);
      pending.expiresAt = currentTime.getTime()+5*60*1000;
      pending.requestedAt = currentTime.getTime();
      pending.attempts = 0;
      req.session.save(err => err ? next(err) : res.json({mfaRequired:true,emailHint:emailHint(user.email)}));
    } catch(err) {next(err);}
  });
  app.post('/api/auth/login/cancel-mfa',(req,res,next) => {
    if (!req.session.pendingAdminMfa) return res.json({ok:true});
    req.session.destroy(err => {
      if (err) return next(err);
      res.clearCookie('pwd.sid');res.json({ok:true});
    });
  });
  app.use('/api',async(req,res,next) => {
    try {
      if (req.session.userId) {
        const currentTime = now().getTime();
        const authenticatedAt = Number(req.session.authenticatedAt) || currentTime;
        const lastActivityAt = Number(req.session.lastActivityAt) || authenticatedAt;
        if (currentTime-authenticatedAt >= MAX_SESSION_LIFETIME_MS ||
            currentTime-lastActivityAt >= IDLE_SESSION_TIMEOUT_MS) {
          return destroySession(req,res,401,'Your session expired. Please sign in again.',next);
        }
        req.session.authenticatedAt = authenticatedAt;
        req.session.lastActivityAt = currentTime;
        req.session.cookie.maxAge = IDLE_SESSION_TIMEOUT_MS;
        const user = await Users.findOne({_id:req.session.userId,status:'Active'});
        // Existing accounts and sessions predate versioning and start at zero.
        if (user && (req.session.sessionVersion ?? 0) === (user.sessionVersion ?? 0)) req.authUser = publicUser(user);
        else return destroySession(req,res,401,'Your session expired. Please sign in again.',next);
      }
      next();
    } catch(err) {next(err);}
  });
  app.post('/api/auth/logout',(req,res,next) => req.session.destroy(err => {
    if (err) return next(err);
    res.clearCookie('pwd.sid');res.json({ok:true});
  }));
  app.get('/api/auth/me',(req,res) => req.authUser ? res.json(req.authUser) : res.status(401).json({message:'Please sign in.'}));
  app.post('/api/auth/password-reset/request',resetRequestLimit,async(req,res,next) => {
    try {
      const email = normalizeEmail(req.body?.email);
      if (!email) return res.status(400).json({message:'Enter a valid email address.'});
      if (!emailConfigured) return res.status(503).json({message:'Password recovery email is not configured. Contact a system administrator.'});
      const genericResponse = {message:'If an active account uses that email, a verification code will be sent. If you do not receive one, contact the system administrator.'};
      const account = await Users.findOne({email,status:'Active'});
      if (!account) return res.json(genericResponse);
      const currentTime = now();
      const otp = generateOtp();
      const otpHash = passwordResetDigest(env.SESSION_SECRET,`${email}\0${otp}`);
      const issued = await Users.findOneAndUpdate({
        _id:account._id,email,status:'Active',
        $or:[
          {resetOtpRequestedAt:{$exists:false}},
          {resetOtpRequestedAt:null},
          {resetOtpRequestedAt:{$lte:new Date(currentTime.getTime()-60*1000)}},
        ],
      },{
        $set:{
          resetOtpHash:otpHash,
          resetOtpExpiresAt:new Date(currentTime.getTime()+5*60*1000),
          resetOtpAttempts:0,
          resetOtpRequestedAt:currentTime,
        },
        $unset:{resetAuthorizationHash:1,resetAuthorizationExpiresAt:1},
      },{new:true});
      if (issued) {
        try {
          await sendPasswordResetEmail(email,otp);
        } catch {
          await Users.updateOne({_id:account._id,resetOtpHash:otpHash},{$unset:{
            resetOtpHash:1,resetOtpExpiresAt:1,resetOtpAttempts:1,
          }});
          console.error('Password recovery email delivery failed.');
        }
      }
      res.json(genericResponse);
    } catch(err) {next(err);}
  });
  app.post('/api/auth/password-reset/verify',resetVerifyLimit,async(req,res,next) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const otp = typeof req.body?.code === 'string' ? req.body.code : '';
      if (!email) return res.status(400).json({message:'Enter a valid email address.'});
      const currentTime = now();
      const account = await Users.findOne({email,status:'Active'}).select('+resetOtpHash +resetOtpExpiresAt +resetOtpAttempts');
      if (!account || !account.resetOtpHash || !account.resetOtpExpiresAt ||
          account.resetOtpExpiresAt <= currentTime || (account.resetOtpAttempts ?? 0) >= 5) {
        return res.status(400).json({message:'Invalid or expired verification code.'});
      }
      const candidateHash = /^\d{6}$/.test(otp)
        ? passwordResetDigest(env.SESSION_SECRET,`${email}\0${otp}`)
        : '';
      const codeMatches = candidateHash.length === account.resetOtpHash.length &&
        crypto.timingSafeEqual(Buffer.from(candidateHash),Buffer.from(account.resetOtpHash));
      if (!codeMatches) {
        const updated = await Users.findOneAndUpdate({
          _id:account._id,resetOtpHash:account.resetOtpHash,
          resetOtpExpiresAt:{$gt:currentTime},resetOtpAttempts:{$lt:5},
        },{$inc:{resetOtpAttempts:1}},{new:true});
        if (updated && updated.resetOtpAttempts >= 5) {
          await Users.updateOne({_id:account._id,resetOtpHash:account.resetOtpHash},{$unset:{
            resetOtpHash:1,resetOtpExpiresAt:1,resetOtpAttempts:1,resetOtpRequestedAt:1,
          }});
        }
        return res.status(400).json({message:'Invalid or expired verification code.'});
      }
      const resetToken = generateResetToken();
      const consumed = await Users.findOneAndUpdate({
        _id:account._id,resetOtpHash:account.resetOtpHash,
        resetOtpExpiresAt:{$gt:currentTime},resetOtpAttempts:{$lt:5},
      },{
        $set:{
          emailVerifiedAt:currentTime,
          resetAuthorizationHash:passwordResetDigest(env.SESSION_SECRET,resetToken),
          resetAuthorizationExpiresAt:new Date(currentTime.getTime()+10*60*1000),
        },
        $unset:{resetOtpHash:1,resetOtpExpiresAt:1,resetOtpAttempts:1,resetOtpRequestedAt:1},
      },{new:true});
      if (!consumed) return res.status(400).json({message:'Invalid or expired verification code.'});
      res.json({resetToken});
    } catch(err) {next(err);}
  });
  app.post('/api/auth/password-reset/complete',resetCompleteLimit,async(req,res,next) => {
    try {
      const resetToken = req.body?.resetToken;
      if (typeof resetToken !== 'string' || resetToken.length < 40 || resetToken.length > 100) {
        return res.status(400).json({message:'Password reset authorization is invalid or expired.'});
      }
      const invalidPassword = passwordError(req.body?.password);
      if (invalidPassword) return res.status(400).json({message:invalidPassword});
      const currentTime = now();
      const authorizationHash = passwordResetDigest(env.SESSION_SECRET,resetToken);
      const account = await Users.findOneAndUpdate({
        resetAuthorizationHash:authorizationHash,
        resetAuthorizationExpiresAt:{$gt:currentTime},
        status:'Active',
      },{
        $set:{passwordHash:await bcrypt.hash(req.body.password,12)},
        $inc:{sessionVersion:1},
        $unset:{
          mustChangePassword:1,
          resetOtpHash:1,resetOtpExpiresAt:1,resetOtpAttempts:1,resetOtpRequestedAt:1,
          resetAuthorizationHash:1,resetAuthorizationExpiresAt:1,
        },
      },{new:true});
      if (!account) return res.status(400).json({message:'Password reset authorization is invalid or expired.'});
      res.json({message:'Password reset successfully.'});
    } catch(err) {next(err);}
  });
  app.post('/api/auth/change-temporary-password',async(req,res,next) => {
    try {
      if (!req.authUser || !req.authUser.mustChangePassword) return res.status(403).json({message:'A temporary password change is not required.'});
      const invalidPassword = passwordError(req.body?.password);
      if (invalidPassword) return res.status(400).json({message:invalidPassword});
      const account = await Users.findOneAndUpdate({
        _id:req.authUser.id,status:'Active',mustChangePassword:true,
        sessionVersion:req.session.sessionVersion ?? 0,
      },{
        $set:{passwordHash:await bcrypt.hash(req.body.password,12)},
        $unset:{
          mustChangePassword:1,
          resetOtpHash:1,resetOtpExpiresAt:1,resetOtpAttempts:1,resetOtpRequestedAt:1,
          resetAuthorizationHash:1,resetAuthorizationExpiresAt:1,
        },
        $inc:{sessionVersion:1},
      },{new:true});
      if (!account) return res.status(401).json({message:'Your session has expired. Sign in again.'});
      req.session.regenerate(err => {
        if (err) return next(err);
        req.session.userId = String(account._id);
        req.session.sessionVersion = account.sessionVersion ?? 0;
        const timestamp = now().getTime();
        req.session.authenticatedAt = timestamp;
        req.session.lastActivityAt = timestamp;
        req.session.cookie.maxAge = IDLE_SESSION_TIMEOUT_MS;
        req.session.save(err => err ? next(err) : res.json(publicUser(account)));
      });
    } catch(err) {next(err);}
  });
  app.use('/api',authorize);
  app.get('/api/users',async(req,res,next) => {
    try {res.json((await Users.find().sort({username:1})).map(publicUser));} catch(err) {next(err);}
  });
  app.post('/api/users',async(req,res,next) => {
    try {
      const {fullname,password,role} = req.body || {};
      const username = normalizeUsername(req.body?.username);
      const email = normalizeEmail(req.body?.email);
      if (!email) return res.status(400).json({message:'Enter a valid email address for this account.'});
      if (!username || typeof fullname !== 'string' || !fullname.trim() || fullname.length > 150 || !['Admin','Staff'].includes(role)) {
        return res.status(400).json({message:'Use a valid username, full name, and role.'});
      }
      const invalidPassword = passwordError(password);
      if (invalidPassword) return res.status(400).json({message:invalidPassword});
      // Wait for the unique index before accepting email-bearing writes.
      await Users.init?.();
      const user = await Users.create({username,fullname:fullname.trim(),email,emailVerifiedAt:null,role,passwordHash:await bcrypt.hash(password,12)});
      res.status(201).json(publicUser(user));
    } catch(err) {if (err.code === 11000) return res.status(409).json({message:duplicateAccountMessage(err)});next(err);}
  });
  app.patch('/api/users/:id',async(req,res,next) => {
    try {
      const {fullname,password} = req.body || {};
      const username = normalizeUsername(req.body?.username);
      const emailProvided = Object.prototype.hasOwnProperty.call(req.body || {},'email');
      const email = emailProvided ? normalizeEmail(req.body.email) : undefined;
      if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({message:'Invalid user ID.'});
      if (emailProvided && !email) return res.status(400).json({message:'Enter a valid email address for this account.'});
      if (!username || typeof fullname !== 'string' || !fullname.trim() || fullname.length > 150) {
        return res.status(400).json({message:'Use a valid username and full name.'});
      }
      const invalidPassword = password !== undefined && password !== '' ? passwordError(password) : '';
      if (invalidPassword) return res.status(400).json({message:invalidPassword});
      if (password) {
        const account = await Users.findOne({_id:req.params.id});
        if (!account) return res.status(404).json({message:'User not found.'});
        if (account.role === 'Staff') return res.status(400).json({message:'Use the Reset Password option to change a staff password.'});
      }
      const changes = {username,fullname:fullname.trim()};
      // An explicitly supplied address is always unverified. Updating it and
      // clearing verification together prevents concurrent edits retaining
      // verification belonging to a different address.
      if (emailProvided) {await Users.init?.();changes.email=email;changes.emailVerifiedAt=null;}
      if (password) changes.passwordHash = await bcrypt.hash(password,12);
      const update = {$set:changes};
      if (password) update.$inc = {sessionVersion:1};
      if (emailProvided || password) update.$unset = {
        resetOtpHash:1,resetOtpExpiresAt:1,resetOtpAttempts:1,resetOtpRequestedAt:1,
        resetAuthorizationHash:1,resetAuthorizationExpiresAt:1,
      };
      const user = await Users.findByIdAndUpdate(req.params.id,update,{new:true,runValidators:true});
      if (!user) return res.status(404).json({message:'User not found.'});
      res.json(publicUser(user));
    } catch(err) {if (err.code === 11000) return res.status(409).json({message:duplicateAccountMessage(err)});next(err);}
  });
  app.post('/api/users/:id/temporary-password',async(req,res,next) => {
    try {
      if (!writeActivityLog) return res.status(503).json({message:'Activity logging is unavailable. Try again later.'});
      if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({message:'Invalid user ID.'});
      if (req.body?.identityVerified !== true) return res.status(400).json({message:"Confirm that the account owner's identity has been verified."});
      const temporaryPassword = generateTemporaryPassword();
      const passwordHash = await bcrypt.hash(temporaryPassword,12);
      let user;
      const reset = async transaction => {
        user = await Users.findOneAndUpdate({
          _id:req.params.id,role:'Staff',status:'Active',
        },{
          $set:{passwordHash,mustChangePassword:true},
          $inc:{sessionVersion:1},
          $unset:{
            resetOtpHash:1,resetOtpExpiresAt:1,resetOtpAttempts:1,resetOtpRequestedAt:1,
            resetAuthorizationHash:1,resetAuthorizationExpiresAt:1,
          },
        },{new:true,runValidators:true,...(transaction ? {session:transaction} : {})});
        if (user) await writeActivityLog({
          staffId:String(req.authUser.id),
          username:req.authUser.username,
          staffName:req.authUser.fullname,
          actorRole:'Admin',
          action:'Reset staff password',
          detail:user.username,
        },transaction);
      };
      if (dependencies.writeActivityLog && typeof Users.db?.startSession === 'function') {
        const transaction = await Users.db.startSession();
        try {await transaction.withTransaction(() => reset(transaction));}
        finally {await transaction.endSession();}
      } else {
        await reset();
      }
      if (!user) return res.status(404).json({message:'Active staff account not found.'});
      res.json({user:publicUser(user),temporaryPassword});
    } catch(err) {next(err);}
  });
  app.patch('/api/users/:id/status',async(req,res,next) => {
    try {
      if (!['Active','Archived'].includes(req.body.status)) return res.status(400).json({message:'Invalid status.'});
      const user = await Users.findOneAndUpdate({_id:req.params.id,role:'Staff'},{
        $set:{status:req.body.status},
        $unset:{
          resetOtpHash:1,resetOtpExpiresAt:1,resetOtpAttempts:1,resetOtpRequestedAt:1,
          resetAuthorizationHash:1,resetAuthorizationExpiresAt:1,
        },
      },{new:true});
      if (!user) return res.status(400).json({message:'Only staff accounts can be archived or activated.'});
      res.json(publicUser(user));
    } catch(err) {next(err);}
  });
}

async function bootstrapAdmin(env=process.env,dependencies={}) {
  const Users = dependencies.User || User;
  if (await Users.exists({role:'Admin'})) return;
  const username = normalizeUsername(env.ADMIN_USERNAME);
  if (!username) throw new Error('Set ADMIN_USERNAME to a valid username for the first administrator.');
  if (passwordError(env.ADMIN_PASSWORD)) {
    throw new Error(`Set ADMIN_PASSWORD for the first administrator. ${PASSWORD_REQUIREMENTS}`);
  }
  const email = normalizeEmail(env.ADMIN_EMAIL);
  if (!email) throw new Error('Set ADMIN_EMAIL to a valid email address for the first administrator.');
  await Users.init?.();
  await Users.create({username,fullname:'System Administrator',email,emailVerifiedAt:null,role:'Admin',passwordHash:await bcrypt.hash(env.ADMIN_PASSWORD,12)});
}
module.exports = {installAuth,bootstrapAdmin,authorize,User};
