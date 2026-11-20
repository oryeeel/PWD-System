const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {normalizeEmail,duplicateAccountMessage} = require('./accountEmail');
const {normalizeUsername} = require('./accountUsername');
const {passwordError} = require('./passwordPolicy');

const assets = new Map([
  ['/', ['text/html; charset=utf-8','index.html']],
  ['/setup.js', ['text/javascript; charset=utf-8','setup.js']],
  ['/setup.css', ['text/css; charset=utf-8','setup.css']],
  ['/password-policy.js', ['text/javascript; charset=utf-8','../passwordPolicy.js']],
]);

function createAdminSetup({token,expiresAt,createAdmin,prefill={},loginUrl,onComplete=()=>{},now=Date.now}) {
  if (!/^[a-f0-9]{64}$/.test(token) || !Number.isFinite(expiresAt)) throw new Error('A temporary setup token and expiry are required.');
  if (!/^http:\/\/localhost:\d+\/login$/.test(loginUrl)) throw new Error('Use the local application sign-in address.');
  let used = false;
  let busy = false;
  const server = http.createServer(async(req,res) => {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'");
    const respond = (code,body) => {res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
    const origin = `http://127.0.0.1:${server.address().port}`;
    if (req.socket.remoteAddress !== '127.0.0.1' || req.headers.host !== new URL(origin).host) return respond(403,{message:'Open the private setup link on this computer.'});
    const asset = assets.get(req.url);
    if (req.method === 'GET' && asset) {
      res.writeHead(200,{'Content-Type':asset[0]});
      return res.end(fs.readFileSync(path.join(__dirname,'admin-setup',asset[1])));
    }
    if (!['/api/setup','/api/create-admin'].includes(req.url)) return respond(404,{message:'Not found.'});
    const supplied = req.headers['x-setup-token'];
    if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied) || !crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(token))) return respond(403,{message:'This setup link is invalid. Open the private setup shortcut.'});
    if (now() >= expiresAt) return respond(410,{message:'This setup link has expired. Ask the maintainer to open a new setup form.'});
    if (used) return respond(410,{message:'This setup link has already been used.'});
    if (req.method === 'GET' && req.url === '/api/setup') return respond(200,{prefill,expiresAt});
    if (req.method !== 'POST' || req.url !== '/api/create-admin') return respond(405,{message:'Method not allowed.'});
    if (req.headers.origin !== origin || req.headers['content-type']?.split(';')[0] !== 'application/json') return respond(403,{message:'Submit the form from its private setup page.'});
    if (busy) return respond(409,{message:'Account creation is already in progress.'});
    busy = true;
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 12000) {respond(413,{message:'The setup request is too large.'});req.resume();return;}
        chunks.push(chunk);
      }
      let body;
      try {body = JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {return respond(400,{message:'The setup request could not be read.'});}
      const username = normalizeUsername(body?.username);
      const email = normalizeEmail(body?.email);
      const fullname = typeof body?.fullname === 'string' ? body.fullname.trim() : '';
      if (!username || !email || !fullname || fullname.length > 150) return respond(400,{message:'Enter a valid full name, username, and email address.'});
      const invalidPassword = passwordError(body.password);
      if (invalidPassword) return respond(400,{message:invalidPassword});
      if (body.password !== body.confirmation) return respond(400,{message:'Passwords do not match.'});
      if (now() >= expiresAt) return respond(410,{message:'This setup link has expired. Ask the maintainer to open a new setup form.'});
      // Burn the capability before the write. Unknown outcomes must not allow
      // another administrator to be created with the same setup link.
      used = true;
      let created;
      try {created = await createAdmin({username,fullname,email,password:body.password,role:'Admin',status:'Active'});}
      catch (error) {
        if (error.code === 11000) {used = false;return respond(409,{message:duplicateAccountMessage(error)});}
        return respond(500,{message:'Could not confirm account creation. Ask the maintainer to check the account before starting setup again.'});
      }
      respond(201,{ok:true,username:created.username,loginUrl});
      try {await onComplete({username:created.username,email:created.email,fullname:created.fullname});} catch { /* The account was created; never reopen the capability. */ }
    } catch {if (!res.headersSent) respond(400,{message:'The setup request could not be completed.'});}
    finally {busy = false;}
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.timeout = 15000;
  return server;
}

module.exports = {createAdminSetup};
