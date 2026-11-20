const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {createAdminSetup} = require('../adminSetup');
const token = 'b'.repeat(64);
const account = {username:'Office.Admin@Gmail.com',fullname:'Office Admin',email:'Office.Admin@Gmail.com',password:'Test-admin1!',confirmation:'Test-admin1!'};

async function setup(t,options={}) {
  const created = [];
  const completed = [];
  const server = createAdminSetup({token,expiresAt:Date.now()+60000,prefill:{fullname:'Office Admin'},loginUrl:'http://localhost:5173/login',createAdmin:async value=>{created.push(value);return value;},onComplete:async value=>completed.push(value),...options});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url='/api/create-admin',{method='POST',body=account,headers={},...rest}={})=>fetch(base+url,{method,headers:{Origin:base,'Content-Type':'application/json','X-Setup-Token':token,...headers},...(method==='POST' ? {body:JSON.stringify(body)} : {}),...rest});
  return {created,completed,request,base};
}

test('private setup requires its token, exact loopback host, and matching origin before any creation',async t=>{
  const fixture = await setup(t);
  for (const headers of [
    {'X-Setup-Token':''},{'X-Setup-Token':'c'.repeat(64)},{'X-Setup-Token':'\u00e9'.repeat(64)},
    {Origin:'http://untrusted.invalid'},
    {'Content-Type':'text/plain'},
  ]) assert.equal((await fixture.request(undefined,{headers})).status,403);
  const wrongHost = await new Promise((resolve,reject)=>{
    const request = http.request(fixture.base+'/api/create-admin',{method:'POST',headers:{Host:'untrusted.invalid',Origin:fixture.base,'Content-Type':'application/json','X-Setup-Token':token}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});
    request.on('error',reject);request.end(JSON.stringify(account));
  });
  assert.equal(wrongHost,403);
  assert.equal(fixture.created.length,0);
  const page = await fixture.request('/',{method:'GET'});
  assert.equal(page.status,200);assert.equal(page.headers.get('cache-control'),'no-store');
  assert.equal(page.headers.get('x-frame-options'),'DENY');assert.equal(page.headers.get('referrer-policy'),'no-referrer');
  assert.ok(!(await page.text()).includes(token));
});

test('setup provides only approved prefill and creates one Admin regardless of forged role or status',async t=>{
  const fixture = await setup(t);
  const prefill = await fixture.request('/api/setup',{method:'GET'});
  assert.equal(prefill.status,200);assert.deepEqual((await prefill.json()).prefill,{fullname:'Office Admin'});
  const response = await fixture.request(undefined,{body:{...account,role:'Staff',status:'Archived',passwordHash:'forged'}});
  assert.equal(response.status,201);
  assert.deepEqual(await response.json(),{ok:true,username:'office.admin@gmail.com',loginUrl:'http://localhost:5173/login'});
  assert.equal(fixture.created.length,1);assert.equal(fixture.created[0].role,'Admin');assert.equal(fixture.created[0].status,'Active');
  assert.equal(fixture.created[0].email,'office.admin@gmail.com');assert.ok(!('passwordHash' in fixture.created[0]));
  assert.equal(fixture.completed.length,1);assert.ok(!('password' in fixture.completed[0]));
  assert.equal((await fixture.request()).status,410);assert.equal(fixture.created.length,1);
});

test('invalid details and mismatched passwords can be corrected without any write',async t=>{
  const fixture = await setup(t);
  for (const change of [{email:'bad'},{username:'bad user'},{fullname:''},{password:'short',confirmation:'short'},{confirmation:'mismatch'}, {password:'\u00e9'.repeat(40),confirmation:'\u00e9'.repeat(40)}]) {
    assert.equal((await fixture.request(undefined,{body:{...account,...change}})).status,400);
  }
  assert.equal(fixture.created.length,0);
  assert.equal((await fixture.request()).status,201);
});

test('private setup rejects weak passwords without consuming the setup link',async t=>{
  const fixture = await setup(t);
  for (const password of [null,123,'lowercase1-only!','UPPERCASE1-ONLY!','OnlyLettersLong1',
    'Mixed123456789','Mixed-case-password!','Mixed Space1','Abcdefghij1\u00e9',
    'Aa'+'\u{1f600}'.repeat(17)+'\u20ac','Aa1'+'\u{1f600}'.repeat(4),'Aa1'+'\u{1f600}'.repeat(18)]) {
    const response = await fixture.request(undefined,{body:{...account,password,confirmation:password}});
    assert.equal(response.status,400);assert.match((await response.json()).message,/password|uppercase letter|lowercase letter|number|special character/i);
  }
  assert.equal(fixture.created.length,0);
  assert.equal((await fixture.request()).status,201);assert.equal(fixture.created.length,1);
});

test('expired tokens never create an account',async t=>{
  const fixture = await setup(t,{expiresAt:Date.now()-1});
  assert.equal((await fixture.request()).status,410);assert.equal(fixture.created.length,0);
});

test('parallel setup submissions create only one account',async t=>{
  let release,entered;
  const started = new Promise(resolve=>entered=resolve);
  let writes = 0;
  const fixture = await setup(t,{createAdmin:async value=>{writes++;entered();await new Promise(resolve=>release=resolve);return value;}});
  const first = fixture.request();await started;
  assert.equal((await fixture.request()).status,410);
  release();assert.equal((await first).status,201);assert.equal(writes,1);
});

test('duplicate account conflicts allow correction, but uncertain writes consume the setup token',async t=>{
  let attempts = 0;
  const fixture = await setup(t,{createAdmin:async value=>{
    if (!attempts++) throw Object.assign(new Error('duplicate'),{code:11000,keyPattern:{email:1}});
    return value;
  }});
  const conflict = await fixture.request();assert.equal(conflict.status,409);assert.match((await conflict.json()).message,/Email address/);
  assert.equal((await fixture.request()).status,201);
  let uncertainWrites = 0;
  const uncertain = await setup(t,{createAdmin:async()=>{uncertainWrites++;throw new Error('private database details');}});
  const response = await uncertain.request();assert.equal(response.status,500);
  assert.ok(!(await response.text()).includes('private database'));
  assert.equal((await uncertain.request()).status,410);assert.equal(uncertainWrites,1);
});
