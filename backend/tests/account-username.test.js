const {test} = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const {installAuth,bootstrapAdmin} = require('../auth');

const password = 'Test-account1!';
const origin = 'http://username-test.invalid';
const account = {username:'pwd.registry.admin@example.com',email:'pwd.registry.admin@example.com',fullname:'Registry Admin',role:'Admin',password};

async function setup(t) {
  const passwordHash = await bcrypt.hash(password,4);
  const admin = {_id:'111111111111111111111111',username:'admin',email:'admin-contact@example.com',fullname:'Admin',role:'Admin',status:'Active',passwordHash};
  const staff = {_id:'222222222222222222222222',username:'Case.User',email:'staff-contact@example.com',fullname:'Staff',role:'Staff',status:'Active',passwordHash};
  const users = [admin,staff];
  const adminCodes = [];
  const calls = {creates:0,updates:0,queries:[]};
  let nextId = 10;
  function matches(user,filter) {
    return Object.entries(filter).every(([key,value])=>key === '$or' ? value.some(clause=>matches(user,clause)) : user[key] === value);
  }
  function unique(candidate,id) {
    for (const field of ['username','email']) {
      if (typeof candidate[field] !== 'string') continue;
      if (users.some(user=>user._id !== id && user[field] === candidate[field])) {
        throw Object.assign(new Error(`Duplicate ${field}`),{code:11000,keyPattern:{[field]:1},keyValue:{[field]:candidate[field]}});
      }
    }
  }
  const User = {
    async init(){},
    findOne(filter) {
      calls.queries.push(filter);
      const user = users.find(user=>matches(user,filter)) || null;
      const result = Promise.resolve(user);result.select=()=>Promise.resolve(user);return result;
    },
    find(){return {sort:async()=>[...users]};},
    async create(values) {
      calls.creates++;unique(values);
      const user = {_id:String(nextId++).padStart(24,'0'),status:'Active',emailVerifiedAt:null,...values};
      users.push(user);return user;
    },
    async findByIdAndUpdate(id,update) {
      calls.updates++;
      const user = users.find(user=>user._id === id);if (!user) return null;
      unique({...user,...update.$set},id);
      Object.assign(user,update.$set);
      if (update.$inc?.sessionVersion) user.sessionVersion=(user.sessionVersion ?? 0)+update.$inc.sessionVersion;
      return user;
    },
  };
  const app = express();app.use(express.json());
  installAuth(app,{SESSION_SECRET:'test-secret-with-more-than-thirty-two-characters',APP_ORIGIN:origin,NODE_ENV:'test'},{User,store:new session.MemoryStore(),emailConfigured:true,sendAdminLoginOtp:async(email,code)=>adminCodes.push({email,code})});
  app.use((error,req,res,next)=>res.status(500).json({message:error.message}));
  const server = app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url,{method='GET',cookie,body}={})=>fetch(base+url,{
    method,headers:{Origin:origin,...(cookie ? {Cookie:cookie} : {}),...(body !== undefined ? {'Content-Type':'application/json'} : {})},
    ...(body !== undefined ? {body:JSON.stringify(body)} : {}),
  });
  async function login(username,suppliedPassword=password,role='Admin') {
    const response = await request('/api/auth/login',{method:'POST',body:{username,password:suppliedPassword,role}});
    const result = await response.clone().json().catch(()=>({}));
    if (!result.mfaRequired) return response;
    const cookie = response.headers.get('set-cookie').split(';')[0];
    return request('/api/auth/login/verify-mfa',{method:'POST',cookie,body:{code:adminCodes[adminCodes.length-1].code}});
  }
  async function adminCookie() {
    const response = await login(admin.username);assert.equal(response.status,200);
    return response.headers.get('set-cookie').split(';')[0];
  }
  return {admin,staff,users,calls,request,login,adminCookie};
}

test('username normalization accepts email addresses while preserving legacy usernames exactly',()=>{
  const {normalizeUsername} = require('../accountUsername');
  assert.equal(normalizeUsername('  Pwd.Registry.Admin@GMAIL.COM  '),'pwd.registry.admin@gmail.com');
  assert.equal(normalizeUsername(" O'Connor+PWD@Example.COM "),"o'connor+pwd@example.com");
  assert.equal(normalizeUsername('First.Last+office@gmail.com'),'first.last+office@gmail.com');
  assert.equal(normalizeUsername('Case.User'),'Case.User');
  assert.equal(normalizeUsername('staff_1-legacy'),'staff_1-legacy');
  assert.equal(normalizeUsername('001'),'001');
  assert.equal(normalizeUsername('a'.repeat(50)),'a'.repeat(50));
  const longEmail = `${'a'.repeat(60)}@example.com`;
  assert.equal(normalizeUsername(longEmail),longEmail);
  for (const input of [undefined,null,123,true,{},[],'','ab',' Case.User ','a b','a'.repeat(51),
    'bad@','a@@example.com','user\n@example.com','a..b@example.com']) {
    assert.equal(normalizeUsername(input),null,JSON.stringify(input));
  }
});

test('administrator can create an email username and sign in using normalized case and whitespace',async t=>{
  const fixture = await setup(t);const cookie = await fixture.adminCookie();
  const created = await fixture.request('/api/users',{method:'POST',cookie,body:{...account,username:'  PWD.Registry.Admin@Example.COM  '}});
  assert.equal(created.status,201);
  const user = await created.json();assert.equal(user.username,account.username);assert.equal(user.email,account.email);
  assert.ok(!('passwordHash' in user));
  const signedIn = await fixture.login('  PWD.REGISTRY.ADMIN@EXAMPLE.COM  ');
  assert.equal(signedIn.status,200);assert.equal((await signedIn.json()).id,user.id);
  const signedInCookie = signedIn.headers.get('set-cookie').split(';')[0];
  const me = await fixture.request('/api/auth/me',{cookie:signedInCookie});
  assert.equal(me.status,200);assert.equal((await me.json()).username,account.username);
});

test('normalized duplicate email usernames return a username conflict even with different contact emails',async t=>{
  const fixture = await setup(t);const cookie = await fixture.adminCookie();
  assert.equal((await fixture.request('/api/users',{method:'POST',cookie,body:account})).status,201);
  const duplicate = await fixture.request('/api/users',{method:'POST',cookie,body:{...account,username:' PWD.REGISTRY.ADMIN@EXAMPLE.COM ',email:'different-contact@example.com'}});
  assert.equal(duplicate.status,409);assert.match((await duplicate.json()).message,/username/i);
  assert.equal(fixture.users.filter(user=>user.username === account.username).length,1);
});

test('legacy usernames remain case sensitive during login',async t=>{
  const fixture = await setup(t);
  assert.equal((await fixture.login('Case.User',password,'Staff')).status,200);
  assert.equal((await fixture.login('case.user',password,'Staff')).status,401);
  assert.notEqual((await fixture.login(' Case.User ',password,'Staff')).status,200);
});

test('login matches registered usernames only and never treats another account email as an alias',async t=>{
  const fixture = await setup(t);
  const emailOwner = {_id:'333333333333333333333333',username:'email.owner',email:'login.name@example.com',fullname:'Email Owner',role:'Staff',status:'Active',passwordHash:await bcrypt.hash('email-owner-password',4)};
  const usernameOwner = {_id:'444444444444444444444444',username:'login.name@example.com',email:'other-contact@example.com',fullname:'Username Owner',role:'Staff',status:'Active',passwordHash:await bcrypt.hash('username-owner-password',4)};
  // An OR query would encounter the contact-email owner first and authenticate
  // the wrong account with that owner's password.
  fixture.users.push(emailOwner,usernameOwner);
  assert.equal((await fixture.login(' LOGIN.NAME@EXAMPLE.COM ','email-owner-password','Staff')).status,401);
  const correct = await fixture.login(' LOGIN.NAME@EXAMPLE.COM ','username-owner-password','Staff');
  assert.equal(correct.status,200);assert.equal((await correct.json()).id,usernameOwner._id);
  assert.equal((await fixture.login(fixture.admin.email,password,'Admin')).status,401);
  const queries = fixture.calls.queries.filter(query=>!('_id' in query));
  assert.ok(queries.length >= 3);
  for (const query of queries) assert.deepEqual(Object.keys(query).sort(),['status','username']);
});

test('administrator edits normalize email usernames without changing the separate contact email',async t=>{
  const fixture = await setup(t);const cookie = await fixture.adminCookie();
  const targetEmail = fixture.staff.email;
  const updated = await fixture.request(`/api/users/${fixture.staff._id}`,{method:'PATCH',cookie,body:{username:'  Staff.Login@Example.COM ',fullname:fixture.staff.fullname}});
  assert.equal(updated.status,200);assert.equal((await updated.json()).username,'staff.login@example.com');
  assert.equal(fixture.staff.email,targetEmail);
  assert.equal((await fixture.login('STAFF.LOGIN@EXAMPLE.COM',password,'Staff')).status,200);
  assert.equal((await fixture.login('Case.User',password,'Staff')).status,401);
  assert.equal((await fixture.request('/api/users',{method:'POST',cookie,body:account})).status,201);
  const conflict = await fixture.request(`/api/users/${fixture.staff._id}`,{method:'PATCH',cookie,body:{username:' PWD.REGISTRY.ADMIN@EXAMPLE.COM ',fullname:'Would Be Changed'}});
  assert.equal(conflict.status,409);assert.match((await conflict.json()).message,/username/i);
  assert.equal(fixture.staff.username,'staff.login@example.com');assert.equal(fixture.staff.fullname,'Staff');
});

test('invalid account usernames are rejected before database writes',async t=>{
  const fixture = await setup(t);const cookie = await fixture.adminCookie();
  for (const username of [undefined,null,123,'ab',' User Name ','bad@']) {
    assert.equal((await fixture.request('/api/users',{method:'POST',cookie,body:{...account,username}})).status,400);
    assert.equal((await fixture.request(`/api/users/${fixture.staff._id}`,{method:'PATCH',cookie,body:{username,fullname:'Staff'}})).status,400);
  }
  assert.equal(fixture.calls.creates,0);assert.equal(fixture.calls.updates,0);
});

test('administrator bootstrap accepts and normalizes email usernames while retaining legacy case',async()=>{
  const created = [];
  const User = {exists:async()=>false,init:async()=>{},create:async user=>{created.push(user);return user;}};
  const env = {ADMIN_USERNAME:'  PWD.Registry.Admin@Example.COM ',ADMIN_EMAIL:'admin-contact@example.com',ADMIN_PASSWORD:password};
  await bootstrapAdmin(env,{User});
  assert.equal(created[0].username,'pwd.registry.admin@example.com');
  assert.equal(created[0].email,'admin-contact@example.com');
  assert.ok(await bcrypt.compare(password,created[0].passwordHash));
  await bootstrapAdmin({...env,ADMIN_USERNAME:'Case.Admin'},{User});
  assert.equal(created[1].username,'Case.Admin');
  await assert.rejects(bootstrapAdmin({...env,ADMIN_USERNAME:'bad@'},{User}),/username|ADMIN_USERNAME/i);
  assert.equal(created.length,2);
});
