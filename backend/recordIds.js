const COUNTER_COLLECTION = 'recordcounters';
const COUNTER_ID = 'pwdId';

function normalizePwdId(value) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const pwdId = value.trim();
  if (!pwdId || pwdId.length > 100 || pwdId === '.' || pwdId === '..') return null;
  return pwdId;
}

// Retained for compatibility with existing backup/restore utilities. New
// records use the official supplied PWD ID and never read or increment this.
async function reserveRecordIdFloor(db, minimum, {session} = {}) {
  if (!Number.isSafeInteger(minimum) || minimum < 0) throw new Error('Invalid PWD record ID counter.');
  const counters = db.collection(COUNTER_COLLECTION);
  const filter = {_id: COUNTER_ID};
  const update = {$max: {value: minimum}};
  try {
    return await counters.updateOne(filter, update, {upsert: true, ...(session ? {session} : {})});
  } catch (error) {
    // Concurrent backup operations can both attempt the initial upsert. In a
    // transaction, let its caller retry the transaction after a write conflict.
    if (error.code !== 11000 || session) throw error;
    const result = await counters.updateOne(filter, update);
    if (result.matchedCount !== 1) throw error;
    return result;
  }
}

module.exports = {normalizePwdId, reserveRecordIdFloor};
