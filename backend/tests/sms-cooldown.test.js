const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createMongoSubmissionStore} = require('../smsCooldown');

function setup() {
  const rows = new Map();
  const duplicate = () => Object.assign(new Error('Duplicate key'),{code:11000});
  const model = {
    findById(id) {return {lean:async()=>rows.get(id)};},
    async findOneAndUpdate(filter,update,options) {
      assert.equal(filter._id,'office-sms');
      assert.equal(options.upsert,true);
      const row = rows.get(filter._id);
      if (row && row.nextSendAt > filter.nextSendAt.$lte) throw duplicate();
      const saved = {_id:filter._id,...update.$set};
      rows.set(filter._id,saved);
      return saved;
    },
    async create(value) {
      if (rows.has(value._id)) throw duplicate();
      rows.set(value._id,value);
      return value;
    },
    async updateOne(filter,update) {
      const row = rows.get(filter._id);
      if (!row || row.fingerprint !== filter.fingerprint) return {matchedCount:0};
      Object.assign(row,update.$set);
      return {matchedCount:1};
    },
  };
  return {rows,model,first:createMongoSubmissionStore(model),second:createMongoSubmissionStore(model)};
}
const request = {requestId:'sms-test-request-0001',fingerprint:'hash-1',now:100000,pendingResult:{status:'Unknown'}};

test('Mongo safeguard atomically admits one batch across independent instances',async()=>{
  const {first,second,rows} = setup();
  const results = await Promise.all([first.claim(request),second.claim({...request,requestId:'sms-test-request-0002'})]);
  assert.deepEqual(results.map(item=>item.status).sort(),['acquired','cooldown']);
  assert.equal(rows.size,2);
  assert.equal(rows.get('office-sms').nextSendAt.getTime(),160000);
});

test('Mongo reservations survive instance replacement, preserve results and reject changed content',async()=>{
  const {first,second,rows} = setup();
  assert.equal((await first.claim(request)).status,'acquired');
  assert.equal((await second.lookup(request)).status,'pending');
  assert.equal((await second.claim({...request,fingerprint:'changed'})).status,'conflict');
  const result = {status:'Queued',results:[{providerMessageId:'provider-id'}]};
  await first.finish({...request,result});
  assert.deepEqual(await second.lookup({...request,now:request.now + 30 * 86400000}),{status:'replay',result});
  assert.equal(rows.get(`request:${request.requestId}`).expiresAt,undefined);
});

test('Mongo pending reservations recover Unknown after the send deadline without releasing their key',async()=>{
  const {first,second} = setup();
  await first.claim(request);
  assert.equal((await second.lookup({...request,now:129999})).status,'pending');
  assert.deepEqual(await second.claim({...request,now:130000}),{status:'replay',result:request.pendingResult});
  assert.deepEqual(await second.claim({...request,now:999999999}),{status:'replay',result:request.pendingResult});
});

test('Mongo errors other than duplicate cooldown refuse sending',async()=>{
  const {model} = setup();
  model.findOneAndUpdate = async()=>{throw new Error('Database unavailable');};
  const store = createMongoSubmissionStore(model);
  await assert.rejects(store.claim(request),/Database unavailable/);
  await assert.rejects(store.finish({...request,result:{}}),/reservation missing/);
});
