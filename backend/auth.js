const session = require('express-session');
const {MongoStore} = require('connect-mongo');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const {rateLimit} = require('express-rate-limit');

const userSchema = new mongoose.Schema({
  username:{type:String,required:true,unique:true},
  fullname:{type:String,required:true},
  passwordHash:{type:String,required:true,select:false},
  role:{type:String,enum:['Admin','Staff'],required:true},
  status:{type:String,enum:['Active','Archived'],default:'Active'},
});
const User = mongoose.models.User || mongoose.model('User',userSchema);
const publicUser = user => ({id:String(user._id),username:user.username,fullname:user.fullname,role:user.role,status:user.status});

function authorize(req,res,next) {
  if (!req.authUser) return res.status(401).json({message:'Please sign in.'});
  const path = req.originalUrl.split('?')[0];
  if ((path.startsWith('/api/users') || path === '/api/activity-logs') && req.authUser.role !== 'Admin') {
    return res.status(403).json({message:'Administrator access required.'});
  }
  if (!['GET','HEAD','OPTIONS'].includes(req.method) && !path.startsWith('/api/users') && req.authUser.role !== 'Staff') {
    return res.status(403).json({message:'Staff access required.'});
  }
  next();
}

function installAuth(app,env=process.env,dependencies={}) {
  const Users = dependencies.User || User;
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32 || !env.APP_ORIGIN) {
    throw new Error('Production requires SESSION_SECRET (at least 32 characters) and APP_ORIGIN.');
  }
  app.set('trust proxy',1);
  app.use('/api',(req,res,next) => {
    res.setHeader('Cache-Control','no-store');
    if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers.origin !== env.APP_ORIGIN) {
      return res.status(403).json({message:'Request origin is not allowed.'});
    }
    next();
  });
  app.use(session({
    name:'pwd.sid',secret:env.SESSION_SECRET,resave:false,saveUninitialized:false,
    store:dependencies.store || MongoStore.create({mongoUrl:env.MONGODB_URI,collectionName:'sessions'}),
    cookie:{httpOnly:true,secure:env.NODE_ENV === 'production',sameSite:'lax',maxAge:8*60*60*1000},
  }));
  const loginLimit = rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:'draft-7',legacyHeaders:false});
  app.post('/api/auth/login',loginLimit,async(req,res,next) => {
    try {
      const {username,password,role} = req.body || {};
      if (typeof username !== 'string' || typeof password !== 'string' || password.length > 128) return res.status(400).json({message:'Enter your username and password.'});
      const user = await Users.findOne({username,status:'Active'}).select('+passwordHash');
      if (!user || user.role !== role || !await bcrypt.compare(password,user.passwordHash)) return res.status(401).json({message:'Invalid username, password, or role.'});
      req.session.regenerate(err => {
        if (err) return next(err);
        req.session.userId = String(user._id);
        req.session.save(err => err ? next(err) : res.json(publicUser(user)));
      });
    } catch(err) {next(err);}
  });
  app.use('/api',async(req,res,next) => {
    try {
      if (req.session.userId) {
        const user = await Users.findOne({_id:req.session.userId,status:'Active'});
        if (user) req.authUser = publicUser(user);
      }
      next();
    } catch(err) {next(err);}
  });
  app.post('/api/auth/logout',(req,res,next) => req.session.destroy(err => {
    if (err) return next(err);
    res.clearCookie('pwd.sid');res.json({ok:true});
  }));
  app.get('/api/auth/me',(req,res) => req.authUser ? res.json(req.authUser) : res.status(401).json({message:'Please sign in.'}));
  app.use('/api',authorize);
  app.get('/api/users',async(req,res,next) => {
    try {res.json((await Users.find().sort({username:1})).map(publicUser));} catch(err) {next(err);}
  });
  app.post('/api/users',async(req,res,next) => {
    try {
      const {username,fullname,password,role} = req.body || {};
      if (typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{3,50}$/.test(username) || typeof fullname !== 'string' || !fullname.trim() || fullname.length > 150 || !['Admin','Staff'].includes(role) || typeof password !== 'string' || password.length < 12 || password.length > 72) {
        return res.status(400).json({message:'Use a valid username, full name, role, and a password of 12–72 characters.'});
      }
      const user = await Users.create({username,fullname:fullname.trim(),role,passwordHash:await bcrypt.hash(password,12)});
      res.status(201).json(publicUser(user));
    } catch(err) {if (err.code === 11000) return res.status(409).json({message:'Username already exists.'});next(err);}
  });
  app.patch('/api/users/:id',async(req,res,next) => {
    try {
      const {username,fullname,password} = req.body || {};
      if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({message:'Invalid user ID.'});
      if (typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{3,50}$/.test(username) || typeof fullname !== 'string' || !fullname.trim() || fullname.length > 150 ||
          (password !== undefined && password !== '' && (typeof password !== 'string' || password.length < 12 || password.length > 72))) {
        return res.status(400).json({message:'Use a valid username, full name, and an optional password of 12–72 characters.'});
      }
      const changes = {username,fullname:fullname.trim()};
      if (password) changes.passwordHash = await bcrypt.hash(password,12);
      const user = await Users.findByIdAndUpdate(req.params.id,{$set:changes},{new:true,runValidators:true});
      if (!user) return res.status(404).json({message:'User not found.'});
      res.json(publicUser(user));
    } catch(err) {if (err.code === 11000) return res.status(409).json({message:'Username already exists.'});next(err);}
  });
  app.patch('/api/users/:id/status',async(req,res,next) => {
    try {
      if (!['Active','Archived'].includes(req.body.status)) return res.status(400).json({message:'Invalid status.'});
      const user = await Users.findOneAndUpdate({_id:req.params.id,role:'Staff'},{$set:{status:req.body.status}},{new:true});
      if (!user) return res.status(400).json({message:'Only staff accounts can be archived or activated.'});
      res.json(publicUser(user));
    } catch(err) {next(err);}
  });
}

async function bootstrapAdmin(env=process.env) {
  if (await User.exists({role:'Admin'})) return;
  if (!env.ADMIN_USERNAME || !/^[a-zA-Z0-9_.-]{3,50}$/.test(env.ADMIN_USERNAME) || !env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 12 || env.ADMIN_PASSWORD.length > 72) {
    throw new Error('Set ADMIN_USERNAME and ADMIN_PASSWORD (12–72 characters) for the first administrator.');
  }
  await User.create({username:env.ADMIN_USERNAME,fullname:'System Administrator',role:'Admin',passwordHash:await bcrypt.hash(env.ADMIN_PASSWORD,12)});
}
module.exports = {installAuth,bootstrapAdmin,authorize};
