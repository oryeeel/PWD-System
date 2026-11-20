const {test} = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const {installAuth,bootstrapAdmin} = require('../auth');

const password = 'Test-account1!';
const origin = 'http://email-test.invalid';
const newAccount = {username:'new.staff',fullname:'New Staff',password,role:'Staff',email:'new.staff@example.com'};

async function setup(t,{beforeInit}={}) {
  const passwordHash = await bcrypt.hash(password,4);
  const admin = {_id:'111111111111111111111111',username:'admin',fullname:'Admin',email:'admin@example.test',role:'Admin',status:'Active',passwordHash};
  const staff = {_id:'222222222222222222222222',username:'staff1',fullname:'Staff One',role:'Staff',status:'Active',passwordHash};
  const archived = {_id:'333333333333333333333333',username:'archived',fullname:'Archived Staff',role:'Staff',status:'Archived',passwordHash,email:'archived@example.com'};
  const users = [admin,staff,archived];
  const calls = {creates:0,updates:0,inits:0};
  const adminCodes = [];
  let nextId = 10;
  function unique(candidate,id) {
    for (const field of ['username','email']) {
      if (typeof candidate[field] !== 'string') continue;
      if (users.some(user=>user._id !== id && user[field] === candidate[field])) {
        throw Object.assign(new Error(`Duplicate ${field}`),{code:11000,keyPattern:{[field]:1},keyValue:{[field]:candidate[field]}});
      }
    }
  }
  const User = {
    async init(){calls.inits++;await beforeInit?.();},
    findOne(filter) {
      const user = users.find(user=>Object.entries(filter).every(([key,value])=>user[key] === value)) || null;
      const result = Promise.resolve(user);result.select=()=>Promise.resolve(user);return result;
    },
    find(){return {sort:async()=>[...users].sort((a,b)=>a.username.localeCompare(b.username))};},
    async create(changes) {
      calls.creates++;
      unique(changes);
      const user = {_id:String(nextId++).padStart(24,'0'),status:'Active',emailVerifiedAt:null,...changes};
      users.push(user);return user;
    },
    async findByIdAndUpdate(id,update) {
      calls.updates++;
      const user = users.find(user=>user._id === id);if (!user) return null;
      unique({...user,...update.$set},id);
      Object.assign(user,update.$set);
      if (update.$inc?.sessionVersion) user.sessionVersion=(user.sessionVersion ?? 0)+update.$inc.sessionVersion;
      for (const key of Object.keys(update.$unset || {})) delete user[key];
      return user;
    },
    async findOneAndUpdate(filter,update) {
      const user = users.find(user=>Object.entries(filter).every(([key,value])=>user[key] === value));
      return user ? this.findByIdAndUpdate(user._id,update) : null;
    },
  };
  const app = express();app.use(express.json());
  installAuth(app,{SESSION_SECRET:'test-secret-with-more-than-thirty-two-characters',APP_ORIGIN:origin,NODE_ENV:'test'},{User,store:new session.MemoryStore(),emailConfigured:true,sendAdminLoginOtp:async(email,code)=>adminCodes.push({email,code})});
  app.get('/api/records',(req,res)=>res.json({username:req.authUser.username}));
  app.use((error,req,res,next)=>res.status(500).json({message:error.message}));
  const server = app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url,{method='GET',cookie,body}={})=>fetch(base+url,{
    method,headers:{Origin:origin,...(cookie ? {Cookie:cookie} : {}),...(body !== undefined ? {'Content-Type':'application/json'} : {})},
    ...(body !== undefined ? {body:JSON.stringify(body)} : {}),
  });
  async function login(user,suppliedPassword=password) {
    const response = await request('/api/auth/login',{method:'POST',body:{username:user.username,role:user.role,password:suppliedPassword}});
    const result = await response.clone().json().catch(()=>({}));
    if (!result.mfaRequired) return response;
    const cookie = response.headers.get('set-cookie').split(';')[0];
    return request('/api/auth/login/verify-mfa',{method:'POST',cookie,body:{code:adminCodes[adminCodes.length-1].code}});
  }
  async function cookieFor(user) {
    const response = await login(user);assert.equal(response.status,200);
    return response.headers.get('set-cookie').split(';')[0];
  }
  return {admin,staff,archived,users,calls,request,login,cookieFor,adminCodes};
}

test('email normalization keeps plus addressing and dots while trimming and lowercasing',()=>{
  const {normalizeEmail} = require('../accountEmail');
  for (const [input,expected] of [
    ['  Jane.Doe+PWD@Example.COM  ','jane.doe+pwd@example.com'],
    ["O'Connor+staff@MSWD.EXAMPLE","o'connor+staff@mswd.example"],
    ['a@sub-domain.example.org','a@sub-domain.example.org'],
    ['first.last+office@gmail.com','first.last+office@gmail.com'],
  ]) assert.equal(normalizeEmail(input),expected);
  assert.notEqual(normalizeEmail('first.last@gmail.com'),normalizeEmail('firstlast@gmail.com'));
  assert.notEqual(normalizeEmail('person+office@gmail.com'),normalizeEmail('person@gmail.com'));
});

test('email normalization rejects invalid syntax and hidden control characters',()=>{
  const {normalizeEmail} = require('../accountEmail');
  for (const value of [undefined,null,123,true,{},[],'','  ','person','@example.com','person@','a@@example.com',
    'a b@example.com','a@exam ple.com','person\n@example.com','person@example.com\r\n',
    '.person@example.com','person.@example.com','per..son@example.com','person@-example.com','person@example-.com',
    'person@example..com','person@exa_mple.com','a'.repeat(65)+'@example.com','a@'+'x'.repeat(64)+'.com']) {
    assert.equal(normalizeEmail(value),null,JSON.stringify(value));
  }
});

test('email uniqueness applies only to stored strings and verification metadata is hidden',()=>{
  const schema = mongoose.models.User.schema;
  const emailIndex = schema.indexes().find(([fields,options])=>fields.email === 1 && options.unique);
  assert.ok(emailIndex,'Email addresses have a unique database index.');
  assert.equal(emailIndex[1].partialFilterExpression.email.$type,'string');
  assert.equal(emailIndex[1].collation.strength,2);
  assert.equal(schema.path('emailVerifiedAt').options.select,false);
  assert.equal(schema.path('emailVerifiedAt').options.default,null);
});

test('administrator creates both roles with normalized emails and public responses hide secrets',async t=>{
  const fixture = await setup(t);const cookie = await fixture.cookieFor(fixture.admin);
  for (const role of ['Admin','Staff']) {
    const response = await fixture.request('/api/users',{method:'POST',cookie,body:{...newAccount,role,username:`new.${role.toLowerCase()}`,email:`  New.${role}@Example.COM  `,emailVerifiedAt:'2026-01-01T00:00:00Z'}});
    assert.equal(response.status,201);
    const user = await response.json();assert.equal(user.email,`new.${role.toLowerCase()}@example.com`);assert.equal(user.role,role);
    assert.ok(!('passwordHash' in user));assert.ok(!('emailVerifiedAt' in user));assert.ok(!('sessionVersion' in user));
    const stored = fixture.users.find(item=>item._id === user.id);
    assert.equal(stored.emailVerifiedAt,null);assert.ok(await bcrypt.compare(password,stored.passwordHash));
  }
  const listing = await fixture.request('/api/users',{cookie});assert.equal(listing.status,200);
  const users = await listing.json();assert.equal(users.find(user=>user.id === fixture.admin._id).email,'admin@example.test');
  assert.equal(users.find(user=>user.username === 'new.staff').email,'new.staff@example.com');
  assert.ok(users.every(user=>!('emailVerifiedAt' in user) && !('passwordHash' in user)));
});

test('missing or invalid email on creation and blank supplied email on editing produce no writes',async t=>{
  const fixture = await setup(t);const cookie = await fixture.cookieFor(fixture.admin);
  for (const email of [undefined,null,'','   ','invalid','a b@example.com',{},123]) {
    const response = await fixture.request('/api/users',{method:'POST',cookie,body:{...newAccount,email}});
    assert.equal(response.status,400);assert.match((await response.json()).message,/email/i);
  }
  for (const email of [null,'','   ','invalid',{},123]) {
    const response = await fixture.request(`/api/users/${fixture.staff._id}`,{method:'PATCH',cookie,body:{username:fixture.staff.username,fullname:fixture.staff.fullname,email}});
    assert.equal(response.status,400);assert.match((await response.json()).message,/email/i);
  }
  assert.equal(fixture.calls.creates,0);assert.equal(fixture.calls.updates,0);
});

test('new account and password-reset requests reject weak passwords without changing accounts',async t=>{
  const fixture = await setup(t);const cookie = await fixture.cookieFor(fixture.admin);
  const originalHash = fixture.staff.passwordHash;
  const invalidPasswords = [null,123,{},'','short','lowercase1-only!','UPPERCASE1-ONLY!',
    'OnlyLettersLong1','Mixed123456789','Mixed-case-password!','Mixed Space1','Abcdefghij1\u00e9',
    'Aa'+'\u{1f600}'.repeat(17)+'\u20ac','Aa1'+'\u{1f600}'.repeat(4),'Aa1'+'\u{1f600}'.repeat(18)];
  for (const candidate of invalidPasswords) {
    const response = await fixture.request('/api/users',{method:'POST',cookie,body:{...newAccount,password:candidate}});
    assert.equal(response.status,400,JSON.stringify(candidate));
    assert.match((await response.json()).message,/password|uppercase letter|lowercase letter|number|special character/i);
    // An empty edit password deliberately means keep the existing password.
    if (candidate === '') continue;
    const reset = await fixture.request(`/api/users/${fixture.staff._id}`,{method:'PATCH',cookie,body:{username:fixture.staff.username,fullname:fixture.staff.fullname,password:candidate}});
    assert.equal(reset.status,400,JSON.stringify(candidate));
    assert.match((await reset.json()).message,/password|uppercase letter|lowercase letter|number|special character/i);
  }
  assert.equal(fixture.calls.creates,0);assert.equal(fixture.calls.updates,0);
  assert.equal(fixture.staff.passwordHash,originalHash);assert.equal(fixture.staff.sessionVersion,undefined);
  const boundaryPassword = 'Aa1'+'\u{1f600}'.repeat(17);
  assert.equal(Array.from(boundaryPassword).length,20);
  assert.equal(Buffer.byteLength(boundaryPassword,'utf8'),71);
  const accepted = await fixture.request('/api/users',{method:'POST',cookie,body:{...newAccount,password:boundaryPassword}});
  assert.equal(accepted.status,201);
  const stored = fixture.users.find(user=>user.username === newAccount.username);
  assert.ok(await bcrypt.compare(boundaryPassword,stored.passwordHash));
});

test('normalized duplicate emails conflict across active and archived accounts, including edits',async t=>{
  const fixture = await setup(t);const cookie = await fixture.cookieFor(fixture.admin);
  fixture.staff.email='staff@example.com';
  for (const email of [' STAFF@EXAMPLE.COM ','ARCHIVED@example.com']) {
    const response = await fixture.request('/api/users',{method:'POST',cookie,body:{...newAccount,email}});
    assert.equal(response.status,409);assert.match((await response.json()).message,/email/i);
  }
  const before = {...fixture.staff};
  const conflict = await fixture.request(`/api/users/${fixture.staff._id}`,{method:'PATCH',cookie,body:{username:fixture.staff.username,fullname:'Changed Name',email:' ARCHIVED@EXAMPLE.COM '}});
  assert.equal(conflict.status,409);assert.match((await conflict.json()).message,/email/i);
  assert.deepEqual(fixture.staff,before);
});

test('concurrent creates with the same normalized email save one account and return one conflict',async t=>{
  const fixture = await setup(t);const cookie = await fixture.cookieFor(fixture.admin);
  const responses = await Promise.all([
    fixture.request('/api/users',{method:'POST',cookie,body:{...newAccount,username:'first.staff',email:'Shared@Example.COM'}}),
    fixture.request('/api/users',{method:'POST',cookie,body:{...newAccount,username:'second.staff',email:' shared@example.com '}}),
  ]);
  assert.deepEqual(responses.map(response=>response.status).sort(),[201,409]);
  const conflict = responses.find(response=>response.status === 409);
  assert.match((await conflict.json()).message,/email/i);
  assert.equal(fixture.users.filter(user=>user.email === 'shared@example.com').length,1);
});

test('account creation waits for index initialization and does not write after an index failure',{timeout:10000},async t=>{
  let enteredInit,finishInit;
  const entered = new Promise(resolve=>{enteredInit=resolve;});
  const fixture = await setup(t,{beforeInit:()=>{enteredInit();return new Promise(resolve=>{finishInit=resolve;});}});
  const cookie = await fixture.cookieFor(fixture.admin);
  const pending = fixture.request('/api/users',{method:'POST',cookie,body:newAccount});
  await entered;
  assert.equal(fixture.calls.creates,0);
  finishInit();
  assert.equal((await pending).status,201);
  assert.equal(fixture.calls.inits,1);

  const failing = await setup(t,{beforeInit:async()=>{throw new Error('Index initialization failed.');}});
  const failedCookie = await failing.cookieFor(failing.admin);
  const failed = await failing.request('/api/users',{method:'POST',cookie:failedCookie,body:newAccount});
  assert.equal(failed.status,500);assert.equal(failing.calls.creates,0);
});

test('anonymous and staff sessions cannot create or change account emails',async t=>{
  const fixture = await setup(t);const staffCookie = await fixture.cookieFor(fixture.staff);
  for (const [cookie,status] of [[undefined,401],[staffCookie,403]]) {
    assert.equal((await fixture.request('/api/users',{method:'POST',cookie,body:newAccount})).status,status);
    assert.equal((await fixture.request(`/api/users/${fixture.admin._id}`,{method:'PATCH',cookie,body:{username:'admin',fullname:'Admin',email:'replacement@example.com'}})).status,status);
    assert.equal((await fixture.request('/api/users',{cookie})).status,status);
  }
  assert.equal(fixture.calls.creates,0);assert.equal(fixture.calls.updates,0);
});

test('legacy staff can log in and edit profiles but permanent password resets are rejected',async t=>{
  const fixture = await setup(t);const cookie = await fixture.cookieFor(fixture.admin);
  const staffLogin = await fixture.login(fixture.staff);assert.equal(staffLogin.status,200);
  const staffPayload = await staffLogin.json();assert.equal(staffPayload.email,'');
  for (const field of ['passwordHash','emailVerifiedAt','sessionVersion']) assert.ok(!(field in staffPayload));
  const staffCookie = staffLogin.headers.get('set-cookie').split(';')[0];
  const originalHash = fixture.staff.passwordHash;
  const edit = body=>fixture.request(`/api/users/${fixture.staff._id}`,{method:'PATCH',cookie,body:{username:fixture.staff.username,fullname:fixture.staff.fullname,...body}});
  const rejected = await edit({password:'Replacement1!'});
  assert.equal(rejected.status,400);assert.match((await rejected.json()).message,/reset password/i);
  assert.equal(fixture.staff.email,undefined);
  assert.equal(fixture.staff.passwordHash,originalHash);
  assert.equal(fixture.staff.sessionVersion,undefined);
  assert.equal((await fixture.request('/api/auth/me',{cookie:staffCookie})).status,200);
  assert.equal((await fixture.login(fixture.staff)).status,200);
  assert.equal((await fixture.login(fixture.staff,'Replacement1!')).status,401);

  fixture.staff.email='existing@example.com';fixture.staff.emailVerifiedAt=new Date('2026-01-01T00:00:00Z');
  const verifiedAt=fixture.staff.emailVerifiedAt;
  assert.equal((await edit({fullname:'Profile Updated',emailVerifiedAt:'2099-01-01T00:00:00Z'})).status,200);
  assert.equal(fixture.staff.email,'existing@example.com');assert.equal(fixture.staff.emailVerifiedAt,verifiedAt);
  assert.equal((await edit({password:''})).status,200);
  assert.equal(fixture.staff.email,'existing@example.com');assert.equal(fixture.staff.emailVerifiedAt,verifiedAt);
  assert.equal(fixture.staff.passwordHash,originalHash);
});

test('administrator password edits preserve omitted email and revoke earlier sessions',async t=>{
  const fixture = await setup(t);const cookie = await fixture.cookieFor(fixture.admin);
  const otherAdmin = {_id:'444444444444444444444444',username:'admin2',fullname:'Second Admin',email:'other-admin@example.test',role:'Admin',status:'Active',passwordHash:await bcrypt.hash(password,4)};
  fixture.users.push(otherAdmin);
  const oldCookie = await fixture.cookieFor(otherAdmin);
  const edit = body=>fixture.request(`/api/users/${otherAdmin._id}`,{method:'PATCH',cookie,body:{username:otherAdmin.username,fullname:otherAdmin.fullname,...body}});
  const changed = await edit({password:'Replacement1!'});
  assert.equal(changed.status,200);
  assert.equal(otherAdmin.email,'other-admin@example.test');
  assert.equal(otherAdmin.sessionVersion,1);
  assert.equal((await fixture.request('/api/auth/me',{cookie:oldCookie})).status,401);
  assert.equal((await fixture.login(otherAdmin)).status,401);
  assert.equal((await fixture.login(otherAdmin,'Replacement1!')).status,200);

  otherAdmin.email='existing-admin@example.com';otherAdmin.emailVerifiedAt=new Date('2026-01-01T00:00:00Z');
  const verifiedAt=otherAdmin.emailVerifiedAt;
  assert.equal((await edit({password:'Another-new1!'})).status,200);
  assert.equal(otherAdmin.email,'existing-admin@example.com');assert.equal(otherAdmin.emailVerifiedAt,verifiedAt);
});

test('supplied email always resets verification and ignores forged role, status and verification fields',async t=>{
  const fixture = await setup(t);const cookie = await fixture.cookieFor(fixture.admin);
  fixture.staff.email='old@example.com';
  for (const email of ['New.Email+PWD@example.com','new.email+pwd@example.com']) {
    fixture.staff.emailVerifiedAt=new Date('2026-01-01T00:00:00Z');
    const response = await fixture.request(`/api/users/${fixture.staff._id}`,{method:'PATCH',cookie,body:{username:fixture.staff.username,fullname:fixture.staff.fullname,email,emailVerifiedAt:'2099-01-01T00:00:00Z',role:'Admin',status:'Archived'}});
    assert.equal(response.status,200);assert.equal((await response.json()).email,'new.email+pwd@example.com');
    assert.equal(fixture.staff.emailVerifiedAt,null);assert.equal(fixture.staff.role,'Staff');assert.equal(fixture.staff.status,'Active');
  }
});

test('first administrator requires ADMIN_EMAIL, while existing administrators keep legacy bootstrap compatibility',async()=>{
  const created = [];
  let existing = false;
  const User = {exists:async()=>existing,create:async user=>{created.push(user);return user;}};
  const env = {ADMIN_USERNAME:'first.admin',ADMIN_PASSWORD:password};
  await assert.rejects(bootstrapAdmin(env,{User}),/ADMIN_EMAIL|email/i);
  await assert.rejects(bootstrapAdmin({...env,ADMIN_EMAIL:'not-an-email'},{User}),/ADMIN_EMAIL|email/i);
  assert.equal(created.length,0);
  await bootstrapAdmin({...env,ADMIN_EMAIL:'  First.Admin+PWD@Example.COM  '},{User});
  assert.equal(created.length,1);assert.equal(created[0].email,'first.admin+pwd@example.com');
  assert.ok(await bcrypt.compare(password,created[0].passwordHash));
  assert.ok(!created[0].emailVerifiedAt);
  existing=true;
  await bootstrapAdmin({}, {User});assert.equal(created.length,1);
});

test('administrator bootstrap rejects weak new passwords before creating an account',async()=>{
  const created = [];
  const User = {exists:async()=>false,create:async user=>{created.push(user);return user;}};
  const env = {ADMIN_USERNAME:'first.admin',ADMIN_EMAIL:'admin@example.com'};
  for (const candidate of [undefined,null,123,'lowercase1-only!','UPPERCASE1-ONLY!','OnlyLettersLong1',
    'Mixed123456789','Mixed-case-password!','Mixed Space1',
    'Aa'+'\u{1f600}'.repeat(17)+'\u20ac','Aa1'+'\u{1f600}'.repeat(4),'Aa1'+'\u{1f600}'.repeat(18)]) {
    await assert.rejects(bootstrapAdmin({...env,ADMIN_PASSWORD:candidate},{User}),/password|ADMIN_PASSWORD/i);
  }
  assert.equal(created.length,0);
});
