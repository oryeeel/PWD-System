const {test} = require('node:test');
const assert = require('node:assert/strict');
const {authorize} = require('../auth');
const {actorFrom} = require('../activityLogs');
const {installAuth} = require('../auth');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
function check(role,method,path) {
  let allowed=false;
  const req={method,originalUrl:path,authUser:role ? {id:'user',username:'verified',fullname:'Verified',role} : undefined,
    headers:{'x-pwd-actor':encodeURIComponent(JSON.stringify({id:'forged',username:'admin',role:'Admin'}))}};
  const res={statusCode:200,status(code){this.statusCode=code;return this},json(){}};
  authorize(req,res,()=>{allowed=true});
  return {allowed,code:res.statusCode,req};
}
test('forged browser actor cannot access a protected API without a server session',()=>{
  for(const path of ['/api/records','/api/users','/api/recycle-bin','/api/activity-logs']) assert.equal(check(null,'GET',path).code,401);
});
test('staff cannot administer users or view staff audit logs',()=>{
  for(const [method,path] of [['GET','/api/users'],['POST','/api/users'],['PATCH','/api/users/id/status'],['GET','/api/activity-logs']]) assert.equal(check('Staff',method,path).code,403);
  assert.equal(check('Staff','GET','/api/records').allowed,true);
  assert.equal(check('Staff','POST','/api/messages/send').allowed,true);
});
test('admin can manage accounts and read records but cannot mutate staff records or send SMS',()=>{
  assert.equal(check('Admin','POST','/api/users').allowed,true);
  assert.equal(check('Admin','GET','/api/records').allowed,true);
  for(const [method,path] of [['PUT','/api/records/PWD-1'],['POST','/api/messages/send'],['POST','/api/records/PWD-1/recycle']]) assert.equal(check('Admin',method,path).code,403);
});
test('audit actor uses the authenticated identity instead of supplied browser headers',()=>{
  const {req}=check('Staff','GET','/api/records');
  assert.equal(actorFrom(req).username,'verified');
});

test('login creates a server session, rejects bad passwords/origins, and logout revokes access',async t=>{
  const user={_id:'staff-id',username:'staff1',fullname:'Office Staff',role:'Staff',status:'Active',passwordHash:await bcrypt.hash('test-password-only',4)};
  const User={findOne(filter){
    const match=user.status==='Active' && (filter.username===user.username || filter._id===user._id) ? user : null;
    const result=Promise.resolve(match);
    result.select=()=>Promise.resolve(match);
    return result;
  }};
  const store=new session.MemoryStore();
  const app=express();app.use(express.json());
  const origin='http://office-test.invalid';
  installAuth(app,{SESSION_SECRET:'a-test-secret-longer-than-thirty-two-characters',APP_ORIGIN:origin,NODE_ENV:'test'},{User,store});
  app.get('/api/records',(req,res)=>res.json({username:req.authUser.username}));
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve))});
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(path,options={})=>fetch(base+path,options);
  const login=password=>request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({username:'staff1',password,role:'Staff'})});
  assert.equal((await request('/api/records')).status,401);
  assert.equal((await login('wrong-password')).status,401);
  assert.equal((await request('/api/auth/login',{method:'POST',headers:{Origin:'http://untrusted.invalid'}})).status,403);
  const response=await login('test-password-only');
  assert.equal(response.status,200);
  assert.ok(!(await response.json()).passwordHash);
  const cookie=response.headers.get('set-cookie').split(';')[0];
  const headers={Cookie:cookie,Origin:origin};
  assert.equal((await request('/api/records',{headers})).status,200);
  assert.equal((await request('/api/users',{headers})).status,403);
  user.status='Archived';
  assert.equal((await request('/api/records',{headers})).status,401);
  user.status='Active';
  assert.equal((await request('/api/auth/logout',{method:'POST',headers})).status,200);
  assert.equal((await request('/api/records',{headers})).status,401);
});

test('admin edits preserve roles and passwords unless a new password is supplied',async t=>{
  const admin={_id:'111111111111111111111111',username:'admin',fullname:'Admin',role:'Admin',status:'Active',passwordHash:await bcrypt.hash('test-password-only',4)};
  const target={_id:'222222222222222222222222',username:'staff1',fullname:'Staff One',role:'Staff',status:'Active',passwordHash:'original-hash'};
  const User={
    findOne(){const result=Promise.resolve(admin);result.select=()=>Promise.resolve(admin);return result},
    async findByIdAndUpdate(id,update){
      if(update.$set.username==='taken'){const err=new Error('duplicate');err.code=11000;throw err}
      if(id!==target._id)return null;
      Object.assign(target,update.$set);return target;
    },
  };
  const app=express();app.use(express.json());
  const origin='http://office-test.invalid';
  installAuth(app,{SESSION_SECRET:'a-test-secret-longer-than-thirty-two-characters',APP_ORIGIN:origin,NODE_ENV:'test'},{User,store:new session.MemoryStore()});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve))});
  const base=`http://127.0.0.1:${server.address().port}`;
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({username:'admin',password:'test-password-only',role:'Admin'})});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const edit=(body,id=target._id)=>fetch(base+'/api/users/'+id,{method:'PATCH',headers:{'Content-Type':'application/json',Origin:origin,Cookie:cookie},body:JSON.stringify(body)});
  const response=await edit({username:'staff.updated',fullname:'Updated Staff',password:'',role:'Admin',status:'Archived'});
  assert.equal(response.status,200);assert.ok(!(await response.json()).passwordHash);
  assert.equal(target.passwordHash,'original-hash');assert.equal(target.role,'Staff');assert.equal(target.status,'Active');
  assert.equal((await edit({username:'staff.updated',fullname:'Updated Staff',password:'short'})).status,400);
  assert.equal((await edit({username:'taken',fullname:'Updated Staff'})).status,409);
  assert.equal((await edit({username:'staff.updated',fullname:'Updated Staff'},'invalid')).status,400);
  assert.equal((await edit({username:'staff.updated',fullname:'Updated Staff',password:'new-test-password'})).status,200);
  assert.ok(await bcrypt.compare('new-test-password',target.passwordHash));
});
