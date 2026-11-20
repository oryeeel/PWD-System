const {test} = require('node:test');
const assert = require('node:assert/strict');
const {normalizePwdId, reserveRecordIdFloor} = require('../recordIds');

test('official IDs retain leading zeros, separators, internal spaces and letter case', () => {
  for (const id of ['001043100000123','10-0431-000-00123','MSWD-001-Aa','001 / 2026']) {
    assert.equal(normalizePwdId(id), id);
    assert.equal(normalizePwdId(`  ${id}  `), id);
  }
});

test('IDs must be nonempty text and cannot contain controls or unsafe standalone path segments', () => {
  for (const value of [undefined,null,123,{},[],true,'','   ','.','..','id\n','id\t123','a\u0000b','a\u007fb','x'.repeat(101)]) {
    assert.equal(normalizePwdId(value), null);
  }
  assert.equal(normalizePwdId('0'), '0');
  assert.equal(normalizePwdId('x'.repeat(100)), 'x'.repeat(100));
});

test('legacy backup reservations preserve higher floors and participate in the transaction', async () => {
  let value = 1004;
  const calls = [];
  const db = {collection(name) {
    assert.equal(name, 'recordcounters');
    return {async updateOne(filter,update,options) {
      calls.push({filter,options});
      value = Math.max(value,update.$max.value);
      return {matchedCount:1};
    }};
  }};
  const session = {id:'backup-session'};
  await reserveRecordIdFloor(db,503,{session});
  assert.equal(value,1004);
  assert.deepEqual(calls[0].filter,{_id:'pwdId'});
  assert.equal(calls[0].options.session,session);
  await reserveRecordIdFloor(db,2000);
  assert.equal(value,2000);
  for (const invalid of [-1,1.5,Infinity,NaN,'2']) await assert.rejects(reserveRecordIdFloor(db,invalid),/Invalid PWD/);
  assert.equal(calls.length,2);
});

test('legacy concurrent reservation retries duplicate upserts only outside transactions', async () => {
  const duplicate = Object.assign(new Error('Duplicate counter'),{code:11000});
  let calls = 0;
  const db = {collection:()=>({updateOne:async(filter,update,options)=>{
    calls++;
    if(options?.upsert)throw duplicate;
    return {matchedCount:1};
  }})};
  await reserveRecordIdFloor(db,10);
  assert.equal(calls,2);
  await assert.rejects(reserveRecordIdFloor(db,10,{session:{}}),error=>error===duplicate);
  assert.equal(calls,3);
});
