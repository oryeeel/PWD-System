const {test} = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const {installAuth} = require('../auth');
const {normalizeOrigin,isAllowedRequestOrigin,authenticatedCorsOptions} = require('../requestOrigin');

test('configured origins tolerate surrounding whitespace and a trailing slash without accepting URLs with paths',()=>{
  assert.equal(normalizeOrigin(' http://localhost:5173/ '),'http://localhost:5173');
  assert.equal(normalizeOrigin('https://pwd.example.com:443/'),'https://pwd.example.com');
  for (const value of [undefined,null,{},'null','file:///test','https://pwd.example.com/login','https://pwd.example.com/?x=1','https://pwd.example.com/#token','https://user:password@pwd.example.com']) {
    assert.equal(normalizeOrigin(value),null);
  }
});

test('local aliases and Vite fallback are development-only while production requires its exact origin',()=>{
  for(const origin of ['http://localhost:5173','http://127.0.0.1:5173','http://[::1]:5173','http://localhost:5174']) {
    assert.equal(isAllowedRequestOrigin(origin,'http://localhost:5173/',{NODE_ENV:'development'}),true);
  }
  for(const origin of [undefined,'null','http://localhost:5175','http://localhost:8081','https://localhost:5173','http://localhost.evil.test:5173','http://192.168.1.10:5173']) {
    assert.equal(isAllowedRequestOrigin(origin,'http://localhost:5173',{NODE_ENV:'development'}),false);
  }
  assert.equal(isAllowedRequestOrigin('http://127.0.0.1:5173','http://localhost:5173',{NODE_ENV:'production'}),false);
  assert.equal(isAllowedRequestOrigin('https://pwd.example.com',' https://pwd.example.com/ ',{NODE_ENV:'production'}),true);
  assert.equal(isAllowedRequestOrigin('https://preview.pwd.example.com','https://pwd.example.com',{NODE_ENV:'production'}),false);
});

test('CORS and login origin checks agree for local hosts and reject unexpected websites',async t=>{
  const env={NODE_ENV:'test',APP_ORIGIN:'http://localhost:5173/',SESSION_SECRET:'test-secret-long-enough-for-origin-fixtures'};
  const app=express();app.use(cors(authenticatedCorsOptions(env)));app.use(express.json());
  installAuth(app,env,{User:{findOne(){throw new Error('Invalid input must not query the database.');}},store:new session.MemoryStore(),emailConfigured:false});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const origin of ['http://localhost:5173','http://127.0.0.1:5173','http://localhost:5174']) {
    const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'!',password:'test-only',role:'Admin'})});
    assert.equal(response.status,400);
    assert.equal(response.headers.get('access-control-allow-origin'),origin);
    assert.equal(response.headers.get('access-control-allow-credentials'),'true');
    assert.notEqual((await response.json()).message,'Request origin is not allowed.');
  }
  const preflight=await fetch(base+'/api/auth/login',{method:'OPTIONS',headers:{Origin:'http://127.0.0.1:5173','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'Content-Type'}});
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),'http://127.0.0.1:5173');
  for(const origin of ['http://localhost:5175','https://untrusted.invalid']) {
    const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
    assert.equal(response.status,403);assert.equal(response.headers.get('access-control-allow-origin'),null);
  }
});
