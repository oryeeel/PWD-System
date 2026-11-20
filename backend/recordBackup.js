const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {gzipSync,gunzipSync} = require('node:zlib');
const {BSON} = require('mongoose').mongo;

const COLLECTION = 'pwdrecords';
const DATA_FILE = 'records.ejson.gz';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function recordsHash(records) {
  const digest = crypto.createHash('sha256');
  for (const record of records) digest.update(BSON.serialize(record));
  return digest.digest('hex');
}
function durableWrite(filename,bytes) {
  const descriptor = fs.openSync(filename,'wx',0o600);
  try {fs.writeFileSync(descriptor,bytes);fs.fsyncSync(descriptor);} finally {fs.closeSync(descriptor);}
}
async function readRecords(db,session) {
  // Native reads include select:false document photos and unknown legacy fields.
  // Preserve numeric BSON types instead of promoting them to JavaScript numbers.
  return db.collection(COLLECTION).find({}, {session,promoteValues:false}).sort({_id:1}).toArray();
}
function validateSource(manifest,db,fingerprint) {
  if (manifest.database !== db.databaseName || manifest.sourceFingerprint !== fingerprint) {
    throw new Error('The backup belongs to a different database. No records were changed.');
  }
}
function readBackup(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));
  if (manifest.format !== 'pwd-records-backup-v1' || manifest.collection !== COLLECTION || manifest.file !== DATA_FILE) {
    throw new Error('Unrecognized record backup.');
  }
  const compressed = fs.readFileSync(path.join(directory,DATA_FILE));
  if (hash(compressed) !== manifest.sha256) throw new Error('Backup checksum verification failed.');
  const records = BSON.EJSON.parse(gunzipSync(compressed).toString('utf8'),{relaxed:false});
  if (!Array.isArray(records) || records.length !== manifest.count || recordsHash(records) !== manifest.recordsSha256) {
    throw new Error('Backup document verification failed.');
  }
  const ids = records.map(record=>String(record._id));
  if (records.some(record=>!record._id) || new Set(ids).size !== records.length) throw new Error('Backup contains invalid or duplicate document IDs.');
  return {manifest,records};
}
async function writeBackup(db,baseDirectory,fingerprint) {
  const records = await readRecords(db);
  const indexes = await db.collection(COLLECTION).listIndexes().toArray();
  const createdAt = new Date().toISOString();
  fs.mkdirSync(baseDirectory,{recursive:true,mode:0o700});
  const directory = fs.mkdtempSync(path.join(baseDirectory,`registry-${createdAt.replace(/[-:.]/g,'')}-`));
  const compressed = gzipSync(BSON.EJSON.stringify(records,{relaxed:false}));
  const highestRecordNumber = records.reduce((highest,record)=>{
    const match = typeof record.pwdId === 'string' && /^PWD-(\d+)$/.exec(record.pwdId);
    return match ? Math.max(highest,Number(match[1])) : highest;
  },0);
  if (!Number.isSafeInteger(highestRecordNumber)) throw new Error('Record ID exceeds the supported numeric range.');
  const manifest = {
    format:'pwd-records-backup-v1',createdAt,timezone:'UTC',database:db.databaseName,
    sourceFingerprint:fingerprint,collection:COLLECTION,file:DATA_FILE,count:records.length,
    archived:records.filter(record=>record.deletedAt != null).length,
    profilePhotos:records.filter(record=>Boolean(record.photo)).length,
    disabilityDocuments:records.filter(record=>Boolean(record.proofOfDisability)).length,
    idPhotos:records.filter(record=>Boolean(record.pwdIdPhoto)).length,
    highestRecordNumber,sha256:hash(compressed),recordsSha256:recordsHash(records),
    indexes:BSON.EJSON.serialize(indexes,{relaxed:false}),
  };
  durableWrite(path.join(directory,DATA_FILE),compressed);
  durableWrite(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  durableWrite(path.join(directory,'README.txt'),
    'Complete PWD record backup, including active/archived records and embedded photos/documents.\n'+
    'records.ejson.gz is gzip-compressed MongoDB Extended JSON; manifest.json contains SHA-256 checksums.\n'+
    'Accounts, sessions, SMS settings, and activity logs were not cleared. Browser SMS history is not in this backup.\n'+
    'Keep this folder private. It is excluded from Git.\n\n'+
    'Verify from the backend folder:\n  node scripts/registryBackup.js verify "'+directory+'"\n'+
    'Restore into the original, EMPTY registry:\n  node scripts/registryBackup.js restore "'+directory+'" --restore-empty\n'+
    'Restoration preserves IDs and timestamps and refuses a nonempty registry. It never lowers the ID counter.\n');
  readBackup(directory);
  return {directory,manifest};
}
async function clearFromBackup(db,client,directory,fingerprint,{reserveFloor}={}) {
  const {manifest,records} = readBackup(directory);
  validateSource(manifest,db,fingerprint);
  if (!records.length) return {deletedCount:0,remaining:await db.collection(COLLECTION).countDocuments({})};
  const reserve = reserveFloor || require('./recordIds').reserveRecordIdFloor;
  const session = client.startSession();
  let deletedCount = 0;
  try {
    await session.withTransaction(async()=>{
      const current = await readRecords(db,session);
      if (recordsHash(current) !== manifest.recordsSha256 || current.length !== records.length) {
        throw new Error('Records changed after the backup. Create a fresh backup before clearing. No records were cleared.');
      }
      await reserve(db,manifest.highestRecordNumber,{session});
      const result = await db.collection(COLLECTION).deleteMany({_id:{$in:records.map(record=>record._id)}},{session});
      if (result.deletedCount !== records.length) throw new Error('Clear count mismatch; transaction aborted.');
      deletedCount = result.deletedCount;
    },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'},readPreference:'primary'});
  } finally {await session.endSession();}
  const result = {deletedCount,remaining:await db.collection(COLLECTION).countDocuments({}),completedAt:new Date().toISOString()};
  durableWrite(path.join(directory,`clear-receipt-${Date.now()}.json`),JSON.stringify(result,null,2)+'\n');
  return result;
}
async function restoreFromBackup(db,client,directory,fingerprint,{reserveFloor}={}) {
  const {manifest,records} = readBackup(directory);
  validateSource(manifest,db,fingerprint);
  const reserve = reserveFloor || require('./recordIds').reserveRecordIdFloor;
  const session = client.startSession();
  try {
    await session.withTransaction(async()=>{
      if (await db.collection(COLLECTION).countDocuments({},{session})) throw new Error('Restore requires an empty registry. No records were changed.');
      if (records.length) await db.collection(COLLECTION).insertMany(records,{session,ordered:true});
      const restored = await readRecords(db,session);
      if (recordsHash(restored) !== manifest.recordsSha256) throw new Error('Restored records did not match the backup; transaction aborted.');
      await reserve(db,manifest.highestRecordNumber,{session});
    },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'},readPreference:'primary'});
  } finally {await session.endSession();}
  return {restoredCount:records.length};
}
module.exports = {writeBackup,readBackup,clearFromBackup,restoreFromBackup,recordsHash};
