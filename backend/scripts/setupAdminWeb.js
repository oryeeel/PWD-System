const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const dns = require('node:dns');
const {createAdminSetup} = require('../adminSetup');
const {User} = require('../auth');
require('dotenv').config({path:path.resolve(__dirname,'../.env'),quiet:true});

async function main() {
  if (!process.env.MONGODB_URI || process.env.SERVER_AUTH !== 'true') throw new Error('Enable shared account sign-in before starting administrator setup.');
  const directory = path.resolve(__dirname,'../node_modules/.cache/admin-setup');
  fs.mkdirSync(directory,{recursive:true});
  const config = JSON.parse(fs.readFileSync(path.join(directory,'profile.json'),'utf8'));
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now()+30*60*1000;
  const accountId = new mongoose.Types.ObjectId();
  const statusFile = path.join(directory,'status.json');
  const shortcut = path.join(directory,'Create Official Admin.url');
  const writeStatus = value => fs.writeFileSync(statusFile,JSON.stringify(value,null,2));
  dns.setServers(['8.8.8.8','8.8.4.4']);
  await mongoose.connect(process.env.MONGODB_URI);
  await User.init();
  const server = createAdminSetup({token,expiresAt,prefill:config,loginUrl:process.env.APP_ORIGIN+'/login',
    createAdmin:async ({password,...account}) => {
      const passwordHash = await bcrypt.hash(password,12);
      try {return await User.create({_id:accountId,...account,passwordHash});}
      catch (failure) {
        if (failure.code === 11000) throw failure;
        // An acknowledgement can be lost after a successful insert.
        const saved = await User.findById(accountId).catch(()=>null);
        if (saved) return saved;
        writeStatus({state:'uncertain',message:'Check the account before restarting setup.'});
        throw failure;
      }
    },
    onComplete:async account => {
      writeStatus({state:'created',...account,completedAt:new Date().toISOString()});
      fs.rmSync(shortcut,{force:true});
      setTimeout(()=>{server.close(()=>{void mongoose.disconnect();});server.closeIdleConnections();},1500).unref();
    },
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const base = `http://127.0.0.1:${server.address().port}`;
  fs.writeFileSync(shortcut,`[InternetShortcut]\r\nURL=${base}/#${token}\r\n`);
  writeStatus({state:'ready',port:server.address().port,expiresAt:new Date(expiresAt).toISOString()});
  console.log('Private admin setup is ready. Open the local setup shortcut.');
  setTimeout(()=>{
    if (fs.existsSync(shortcut)) {fs.rmSync(shortcut);writeStatus({state:'expired'});}
    server.close(()=>{void mongoose.disconnect();});server.closeIdleConnections();
  },30*60*1000).unref();
}

if (require.main === module) main().catch(async()=>{
  console.error('Private admin setup could not start. Check the local configuration and database connection.');
  await mongoose.disconnect();process.exitCode = 1;
});
