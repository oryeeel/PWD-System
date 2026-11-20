const crypto = require('node:crypto');

const STATE_ID = 'activity-logs';
const VERSION = 1;

function assertKey(key) {
  if (typeof key !== 'string' || Buffer.byteLength(key) < 32) {
    throw new Error('AUDIT_LOG_HMAC_KEY must contain at least 32 bytes.');
  }
}

function normalize(value) {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (value && typeof value.toHexString === 'function') return value.toHexString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key,normalize(value[key])]));
  }
  return value;
}

function canonicalize(value) {
  return JSON.stringify(normalize(value));
}

function hmac(key,value) {
  return crypto.createHmac('sha256',key).update(value).digest('hex');
}

function sameDigest(left,right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left),Buffer.from(right));
}

function baselineDigest(key,entries) {
  const hash = crypto.createHmac('sha256',key).update('pwd-activity-baseline-v1\0');
  for (const entry of entries) hash.update(canonicalize(entry)).update('\n');
  return hash.digest('hex');
}

function baselineSignature(key,count,digest,createdAt) {
  return hmac(key,`pwd-activity-baseline-signature-v1\0${VERSION}\0${count}\0${digest}\0${createdAt.toISOString()}`);
}

function baselineAnchor(key,count,digest,signature) {
  return hmac(key,`pwd-activity-baseline-anchor-v1\0${count}\0${digest}\0${signature}`);
}

function validateStateKey(key,state) {
  const expectedSignature = baselineSignature(
    key,state.baselineCount,state.baselineHash,new Date(state.createdAt),
  );
  if (!sameDigest(expectedSignature,state.baselineSignature)) {
    throw new Error('AUDIT_LOG_HMAC_KEY does not match the initialized activity log chain.');
  }
}

function entryDigest(key,sequence,previousHash,entry) {
  const payload = {...entry};
  delete payload._id;
  delete payload.__v;
  delete payload.chainSequence;
  delete payload.previousHash;
  delete payload.entryHash;
  return hmac(key,`pwd-activity-entry-v1\0${sequence}\0${previousHash}\0${canonicalize(payload)}`);
}

async function initializeAuditChain(ActivityLog,AuditChainState,key,createdAt=new Date()) {
  assertKey(key);
  const current = await AuditChainState.findById(STATE_ID).lean();
  if (current) {
    validateStateKey(key,current);
    return current;
  }

  const chainedCount = await ActivityLog.collection.countDocuments({chainSequence:{$exists:true}});
  if (chainedCount) throw new Error('Activity log chain state is missing; refusing to create a new baseline.');
  const entries = await ActivityLog.collection.find({chainSequence:{$exists:false}})
    .sort({createdAt:1,_id:1}).toArray();
  const digest = baselineDigest(key,entries);
  const created = new Date(createdAt);
  const signature = baselineSignature(key,entries.length,digest,created);
  const state = {
    _id:STATE_ID,version:VERSION,baselineCount:entries.length,baselineHash:digest,
    baselineSignature:signature,sequence:0,
    lastHash:baselineAnchor(key,entries.length,digest,signature),
    createdAt:created,updatedAt:created,
  };
  try {
    return await AuditChainState.create(state);
  } catch(error) {
    if (error.code !== 11000) throw error;
    const initialized = await AuditChainState.findById(STATE_ID).lean();
    if (!initialized) throw error;
    validateStateKey(key,initialized);
    return initialized;
  }
}

async function appendAuditEntry(ActivityLog,AuditChainState,key,entry,transactionSession) {
  assertKey(key);
  const append = async session => {
    const state = await AuditChainState.findById(STATE_ID).session(session).lean();
    if (!state) throw new Error('Activity log integrity has not been initialized.');
    const sequence = state.sequence+1;
    const previousHash = state.lastHash;
    const record = {
      staffId:entry.staffId,
      username:entry.username,
      staffName:entry.staffName,
      action:entry.action,
      recordId:entry.recordId || '',
      detail:entry.detail || '',
      ...(entry.actorRole ? {actorRole:entry.actorRole} : {}),
      createdAt:entry.createdAt || new Date(),
    };
    const digest = entryDigest(key,sequence,previousHash,record);
    const update = await AuditChainState.updateOne(
      {_id:STATE_ID,sequence:state.sequence,lastHash:previousHash},
      {$set:{sequence,lastHash:digest,updatedAt:record.createdAt}},
      {session},
    );
    if (update.modifiedCount !== 1) throw new Error('Activity log chain changed during append.');
    const [saved] = await ActivityLog.create([{
      ...record,chainSequence:sequence,previousHash,entryHash:digest,
    }],{session});
    return saved;
  };
  if (transactionSession) return append(transactionSession);
  const session = await ActivityLog.db.startSession();
  let saved;
  try {
    await session.withTransaction(async() => {saved=await append(session)});
    return saved;
  } finally {
    await session.endSession();
  }
}

async function verifyAuditChain(ActivityLog,AuditChainState,key) {
  assertKey(key);
  const state = await AuditChainState.findById(STATE_ID).lean();
  if (!state || state.version !== VERSION) return {valid:false,reason:'not_initialized'};

  const legacyEntries = await ActivityLog.collection.find({chainSequence:{$exists:false}})
    .sort({createdAt:1,_id:1}).toArray();
  const digest = baselineDigest(key,legacyEntries);
  const signature = baselineSignature(key,state.baselineCount,state.baselineHash,new Date(state.createdAt));
  if (legacyEntries.length !== state.baselineCount || !sameDigest(digest,state.baselineHash) ||
      !sameDigest(signature,state.baselineSignature)) {
    return {valid:false,reason:'baseline_mismatch',legacyEntries:legacyEntries.length};
  }

  const chainedEntries = await ActivityLog.collection.find({chainSequence:{$exists:true}})
    .sort({chainSequence:1}).toArray();
  let previousHash = baselineAnchor(key,state.baselineCount,state.baselineHash,state.baselineSignature);
  let expectedSequence = 1;
  for (const entry of chainedEntries) {
    if (entry.chainSequence !== expectedSequence || entry.previousHash !== previousHash ||
        !sameDigest(entryDigest(key,expectedSequence,previousHash,entry),entry.entryHash)) {
      return {valid:false,reason:'chain_mismatch',legacyEntries:legacyEntries.length,chainedEntries:chainedEntries.length};
    }
    previousHash = entry.entryHash;
    expectedSequence += 1;
  }
  if (chainedEntries.length !== state.sequence || previousHash !== state.lastHash) {
    return {valid:false,reason:'chain_mismatch',legacyEntries:legacyEntries.length,chainedEntries:chainedEntries.length};
  }
  return {valid:true,legacyEntries:legacyEntries.length,chainedEntries:chainedEntries.length,latestSequence:state.sequence};
}

module.exports = {initializeAuditChain,appendAuditEntry,verifyAuditChain,baselineDigest,entryDigest};
