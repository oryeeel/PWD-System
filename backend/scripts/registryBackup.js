// Explicit maintenance command; never loads server.js or starts archive cleanup.
const path = require('node:path');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const {writeBackup,readBackup,clearFromBackup,restoreFromBackup} = require('../recordBackup');
require('dotenv').config({path:path.join(__dirname,'../.env'),quiet:true});
require('node:dns').setServers(['8.8.8.8','8.8.4.4']);

async function main() {
  const [command,directory,flag] = process.argv.slice(2);
  if (!['inspect','backup','verify','clear','restore'].includes(command)) throw new Error('Use inspect, backup, verify <folder>, clear <folder> --clear-backed-up-records, or restore <folder> --restore-empty.');
  if (['verify','clear','restore'].includes(command) && !directory) throw new Error('A backup folder is required.');
  if (command === 'clear' && flag !== '--clear-backed-up-records') throw new Error('Clearing requires --clear-backed-up-records.');
  if (command === 'restore' && flag !== '--restore-empty') throw new Error('Restoring requires --restore-empty.');
  if (command === 'verify') {
    const {manifest} = readBackup(path.resolve(directory));
    console.log(JSON.stringify({verified:true,...manifest,indexes:undefined,sourceFingerprint:undefined}));return;
  }
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is missing.');
  // SRV DNS resolution may outlast serverSelectionTimeoutMS. Bound connection
  // attempts without exposing a credential-bearing connection error.
  const timer = setTimeout(()=>{console.error('Database connection timed out. No operation was started.');process.exit(1);},25000);
  try {await mongoose.connect(process.env.MONGODB_URI,{serverSelectionTimeoutMS:10000,connectTimeoutMS:10000,autoIndex:false});}
  finally {clearTimeout(timer);}
  const db = mongoose.connection.db;
  const client = mongoose.connection.getClient();
  const cluster = client.options.srvHost || client.options.hosts.map(host=>host.toString()).sort().join(',');
  const fingerprint = crypto.createHash('sha256').update(`${cluster}/${db.databaseName}`).digest('hex');
  if (command === 'inspect') {
    const records = db.collection('pwdrecords');
    console.log(JSON.stringify({database:db.databaseName,records:await records.countDocuments({}),archived:await records.countDocuments({deletedAt:{$ne:null}})}));
  } else if (command === 'backup') {
    const result = await writeBackup(db,path.join(__dirname,'../backups'),fingerprint);
    console.log(JSON.stringify({directory:result.directory,verified:true,...result.manifest,indexes:undefined,sourceFingerprint:undefined}));
  } else {
    const operation = command === 'clear' ? clearFromBackup : restoreFromBackup;
    console.log(JSON.stringify(await operation(db,client,path.resolve(directory),fingerprint)));
  }
}
main().catch(error=>{
  // Only local guard messages are safe to print; driver errors can contain URIs.
  console.error(error.name === 'Error' ? error.message : `Operation failed (${error.name || 'unknown error'}). Check the database connection and backup before retrying.`);
  process.exitCode=1;
}).finally(()=>mongoose.disconnect());
