const {test} = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const {installAuth} = require('../auth');
const {passwordError} = require('../passwordPolicy');
const {generateOtp,generateTemporaryPassword,passwordResetDigest} = require('../passwordRecovery');

const origin = 'http://office-test.invalid';
const sessionSecret = 'a-test-secret-longer-than-thirty-two-characters';
const initialPassword = 'Old-test-password1!';
const staffId = '222222222222222222222222';
const adminId = '111111111111111111111111';

function matches(user,filter) {
  for (const [key,expected] of Object.entries(filter)) {
    if (key === '$or') {
      if (!expected.some(branch=>matches(user,branch))) return false;
      continue;
    }
    const actual=user[key];
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      for (const [operator,value] of Object.entries(expected)) {
        if (operator === '$exists' && (actual !== undefined) !== value) return false;
        if (operator === '$lte' && !(actual != null && actual <= value)) return false;
        if (operator === '$lt' && !(actual != null && actual < value)) return false;
        if (operator === '$gt' && !(actual != null && actual > value)) return false;
      }
    } else if (actual !== expected) return false;
  }
  return true;
}

function apply(user,update) {
  Object.assign(user,update.$set || {});
  for (const key of Object.keys(update.$unset || {})) delete user[key];
  for (const [key,value] of Object.entries(update.$inc || {})) user[key]=(user[key] || 0)+value;
}

async function setup(t,options={}) {
  let currentTime=new Date('2026-11-19T10:00:00.000Z');
  const users=[
    {_id:adminId,username:'admin',fullname:'Office Admin',email:'admin@example.test',role:'Admin',status:'Active',passwordHash:await bcrypt.hash(initialPassword,4),sessionVersion:0},
    {_id:staffId,username:'staff1',fullname:'Office Staff',email:'staff@example.test',role:'Staff',status:'Active',passwordHash:await bcrypt.hash(initialPassword,4),sessionVersion:0},
  ];
  const User={
    findOne(filter) {
      const result=Promise.resolve(users.find(user=>matches(user,filter)) || null);
      result.select=()=>result;
      return result;
    },
    async findOneAndUpdate(filter,update) {
      const user=users.find(item=>matches(item,filter));
      if (!user) return null;
      apply(user,update);
      return user;
    },
    async updateOne(filter,update) {
      const user=users.find(item=>matches(item,filter));
      if (user) apply(user,update);
      return {modifiedCount:user?1:0};
    },
  };
  const sent=[];
  const adminCodes=[];
  const logs=[];
  const store=new session.MemoryStore();
  const app=express();
  app.use(express.json());
  installAuth(app,{
    SESSION_SECRET:sessionSecret,APP_ORIGIN:origin,NODE_ENV:'test',
  },{
    User,store,
    ActivityLog:{create:async event=>logs.push(event)},
    emailConfigured:true,
    sendPasswordResetEmail:options.sendPasswordResetEmail || (async(email,code)=>sent.push({email,code})),
    sendAdminLoginOtp:async(email,code)=>adminCodes.push({email,code}),
    now:()=>new Date(currentTime),
  });
  app.get('/api/records',(req,res)=>res.json({ok:true}));
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve))});
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(path,body,options={})=>fetch(base+path,{
    ...options,
    method:options.method || 'POST',
    headers:{Origin:origin,...(body===undefined?{}:{'Content-Type':'application/json'}),...(options.headers || {})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  });
  return {request,users,sent,adminCodes,logs,advanceMilliseconds:value=>{currentTime=new Date(currentTime.getTime()+value)}};
}

test('recovery sends an OTP privately, consumes it once, resets the password and revokes sessions',async t=>{
  const {request,users,sent}=await setup(t);
  const login=await request('/api/auth/login',{username:'staff1',password:initialPassword,role:'Staff'});
  assert.equal(login.status,200);
  const oldCookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/api/records',undefined,{method:'GET',headers:{Cookie:oldCookie}})).status,200);
  users[1].mustChangePassword=true;

  const unknown=await request('/api/auth/password-reset/request',{email:'unknown@example.test'});
  const response=await request('/api/auth/password-reset/request',{email:'STAFF@example.test'});
  assert.equal(response.status,200);
  const responseText=await response.text();
  assert.deepEqual(JSON.parse(responseText),await unknown.json());
  assert.equal(sent.length,1);
  assert.match(sent[0].code,/^\d{6}$/);
  assert.notEqual(users[1].resetOtpHash,sent[0].code);
  assert.equal(responseText.includes(sent[0].code),false);

  const throttled=await request('/api/auth/password-reset/request',{email:'staff@example.test'});
  assert.equal(throttled.status,200);
  assert.equal(sent.length,1);

  const unauthorized=await request('/api/auth/password-reset/complete',{password:'New-safe-password2!'});
  assert.equal(unauthorized.status,400);
  const verification=await request('/api/auth/password-reset/verify',{email:'staff@example.test',code:sent[0].code});
  assert.equal(verification.status,200);
  const {resetToken}=await verification.json();
  assert.equal(typeof resetToken,'string');
  assert.equal(users[1].resetOtpHash,undefined);
  assert.equal((await request('/api/auth/password-reset/verify',{email:'staff@example.test',code:sent[0].code})).status,400);

  const completed=await request('/api/auth/password-reset/complete',{resetToken,password:'New-safe-password2!'});
  assert.equal(completed.status,200);
  assert.equal(users[1].mustChangePassword,undefined);
  assert.equal((await request('/api/auth/password-reset/complete',{resetToken,password:'Other-safe-password3!'})).status,400);
  assert.equal((await request('/api/records',undefined,{method:'GET',headers:{Cookie:oldCookie}})).status,401);
  assert.equal((await request('/api/auth/login',{username:'staff1',password:initialPassword,role:'Staff'})).status,401);
  assert.equal((await request('/api/auth/login',{username:'staff1',password:'New-safe-password2!',role:'Staff'})).status,200);
});

test('incorrect codes are counted to five and expired codes cannot be used',async t=>{
  const {request,users,sent,advanceMilliseconds}=await setup(t);
  await request('/api/auth/password-reset/request',{email:'staff@example.test'});
  for (let attempt=0;attempt<5;attempt++) {
    assert.equal((await request('/api/auth/password-reset/verify',{email:'staff@example.test',code:'000000'})).status,400);
  }
  assert.equal(users[1].resetOtpHash,undefined);
  assert.equal((await request('/api/auth/password-reset/verify',{email:'staff@example.test',code:sent[0].code})).status,400);

  advanceMilliseconds(61*1000);
  await request('/api/auth/password-reset/request',{email:'staff@example.test'});
  advanceMilliseconds(5*60*1000+1);
  assert.equal((await request('/api/auth/password-reset/verify',{email:'staff@example.test',code:sent[1].code})).status,400);
  advanceMilliseconds(61*1000);
  await request('/api/auth/password-reset/request',{email:'staff@example.test'});
  const verification=await request('/api/auth/password-reset/verify',{email:'staff@example.test',code:sent[2].code});
  const {resetToken}=await verification.json();
  advanceMilliseconds(10*60*1000+1);
  assert.equal((await request('/api/auth/password-reset/complete',{resetToken,password:'Expired-safe-pass2!'})).status,400);
});

test('email delivery failures stay generic and do not leave a usable code',async t=>{
  const {request,users}=await setup(t,{sendPasswordResetEmail:async()=>{throw new Error('private SMTP details');}});
  const unknown=await request('/api/auth/password-reset/request',{email:'unknown@example.test'});
  const failed=await request('/api/auth/password-reset/request',{email:'staff@example.test'});
  assert.equal(failed.status,200);
  assert.deepEqual(await failed.json(),await unknown.json());
  assert.equal(users[1].resetOtpHash,undefined);
  assert.ok(users[1].resetOtpRequestedAt instanceof Date);
  assert.equal((await request('/api/auth/password-reset/verify',{email:'staff@example.test',code:'123456'})).status,400);
});

test('admin temporary passwords require verification, force change at login and are audited',async t=>{
  const {request,users,logs,adminCodes}=await setup(t);
  const adminChallenge=await request('/api/auth/login',{username:'admin',password:initialPassword,role:'Admin'});
  const challengeCookie=adminChallenge.headers.get('set-cookie').split(';')[0];
  const adminLogin=await request('/api/auth/login/verify-mfa',{code:adminCodes[0].code},{headers:{Cookie:challengeCookie}});
  const adminCookie=adminLogin.headers.get('set-cookie').split(';')[0];
  const staffLogin=await request('/api/auth/login',{username:'staff1',password:initialPassword,role:'Staff'});
  const staffCookie=staffLogin.headers.get('set-cookie').split(';')[0];
  const path=`/api/users/${staffId}/temporary-password`;
  assert.equal((await request(path,{identityVerified:true},{headers:{Cookie:staffCookie}})).status,403);
  assert.equal((await request(path,{identityVerified:false},{headers:{Cookie:adminCookie}})).status,400);

  const reset=await request(path,{identityVerified:true},{headers:{Cookie:adminCookie}});
  assert.equal(reset.status,200);
  const result=await reset.json();
  assert.equal(result.user.mustChangePassword,true);
  assert.equal(result.user.passwordHash,undefined);
  assert.equal(users[1].mustChangePassword,true);
  assert.equal(logs.length,1);
  assert.equal(logs[0].action,'Reset staff password');
  assert.equal(logs[0].actorRole,'Admin');
  assert.equal(logs[0].detail,'staff1');
  assert.equal((await request('/api/records',undefined,{method:'GET',headers:{Cookie:staffCookie}})).status,401);

  const temporaryLogin=await request('/api/auth/login',{username:'staff1',password:result.temporaryPassword,role:'Staff'});
  assert.equal(temporaryLogin.status,200);
  assert.equal((await temporaryLogin.json()).mustChangePassword,true);
  const temporaryCookie=temporaryLogin.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/api/records',undefined,{method:'GET',headers:{Cookie:temporaryCookie}})).status,403);
  const change=await request('/api/auth/change-temporary-password',{password:'Final-safe-pass4!'},{headers:{Cookie:temporaryCookie}});
  assert.equal(change.status,200);
  assert.equal((await change.json()).mustChangePassword,false);
  assert.equal(users[1].mustChangePassword,undefined);
  assert.equal((await request('/api/auth/login',{username:'staff1',password:result.temporaryPassword,role:'Staff'})).status,401);
  assert.equal((await request('/api/auth/login',{username:'staff1',password:'Final-safe-pass4!',role:'Staff'})).status,200);
});

test('recovery helpers generate constrained secrets and hash with a keyed digest',()=>{
  assert.match(generateOtp(),/^\d{6}$/);
  const password=generateTemporaryPassword();
  assert.equal(passwordError(password),'');
  assert.notEqual(passwordResetDigest(sessionSecret,'code'),passwordResetDigest('different-secret','code'));
});
