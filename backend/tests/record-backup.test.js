const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {BSON} = require('mongoose').mongo;
const {writeBackup,readBackup,clearFromBackup,restoreFromBackup} = require('../recordBackup');

const fingerprint = 'test-database-fingerprint';
const clone = value => BSON.deserialize(BSON.serialize(value),{promoteValues:false});
const copyRows = rows => rows.map(clone);
function fixtures() {
  return [{
    _id:new BSON.ObjectId('111111111111111111111111'),pwdId:'PWD-0099',firstName:'Sample',lastName:'Resident',
    photo:'data:image/jpeg;base64,cHJvZmlsZQ==',
    proofOfDisability:'data:image/png;base64,cHJvb2Y=',
    pwdIdPhoto:'data:image/png;base64,aWQ=',
    deletedAt:null,createdAt:new Date('2025-02-03T04:05:06.789Z'),
    age:new BSON.Int32(42),legacyTotal:BSON.Long.fromString('9007199254740993'),
    legacyFraction:new BSON.Double(1.25),legacyFields:{note:'Preserve unknown fields',flag:true},
  },{
    _id:new BSON.ObjectId('222222222222222222222222'),pwdId:'PWD-10000',firstName:'Archived',lastName:'Resident',
    deletedAt:new Date('2026-01-01T00:00:00Z'),createdAt:new Date('2024-01-01T00:00:00Z'),
    photo:'',proofOfDisability:'',pwdIdPhoto:'',age:new BSON.Int32(30),
  }];
}
function tempDirectory(t) {
  const base = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(base,'pwd-record-backup-tests-'));
  t.after(()=>{
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved),base);
    assert.ok(path.basename(resolved).startsWith('pwd-record-backup-tests-'));
    fs.rmSync(resolved,{recursive:true,force:true});
  });
  return directory;
}
function fakeDatabase(rows,{deleteCountOffset=0,corruptInsert=false}={}) {
  const state = {records:copyRows(rows),floor:0};
  const calls = {collections:[],deletions:[],insertions:0,reservations:[],sessions:[]};
  const view = session => session ? session.draft : state;
  const collection = {
    find(filter,options={}) {
      assert.deepEqual(filter,{});
      return {sort(order){
        assert.deepEqual(order,{_id:1});
        return {async toArray(){return copyRows(view(options.session).records).sort((a,b)=>String(a._id).localeCompare(String(b._id)))}};
      }};
    },
    listIndexes(){return {async toArray(){return [{v:2,name:'_id_',key:{_id:1}},{v:2,name:'pwdId_1',key:{pwdId:1},unique:true}]}}},
    async countDocuments(filter,options={}){assert.deepEqual(filter,{});return view(options.session).records.length},
    async deleteMany(filter,options){
      assert.ok(options.session?.draft,'Deletion must happen inside a transaction');
      calls.deletions.push(filter);
      assert.deepEqual(Object.keys(filter),['_id']);
      const ids = new Set(filter._id.$in.map(String));
      const target = view(options.session);
      const before = target.records.length;
      target.records = target.records.filter(record=>!ids.has(String(record._id)));
      return {deletedCount:before-target.records.length+deleteCountOffset};
    },
    async insertMany(records,options){
      assert.ok(options.session?.draft,'Restoration must happen inside a transaction');
      calls.insertions++;
      const target = view(options.session);
      for (const record of records) {
        if (target.records.some(saved=>String(saved._id)===String(record._id))) throw new Error('Duplicate document ID');
        target.records.push(clone(record));
      }
      if (corruptInsert && target.records.length) target.records[0].firstName = 'Unexpected mutation';
    },
  };
  const db = {databaseName:'backup-test',collection(name){calls.collections.push(name);assert.equal(name,'pwdrecords');return collection}};
  const client = {startSession(){
    const session = {
      draft:null,committed:false,aborted:false,ended:false,
      async withTransaction(callback,options){
        assert.equal(options.readConcern.level,'snapshot');
        assert.equal(options.writeConcern.w,'majority');
        this.draft = {records:copyRows(state.records),floor:state.floor};
        try {
          await callback();
          state.records = this.draft.records;state.floor = this.draft.floor;this.committed = true;
        } catch(error) {this.aborted=true;throw error;}
        finally {this.draft=null;}
      },
      async endSession(){this.ended=true},
    };
    calls.sessions.push(session);return session;
  }};
  const reserveFloor = async (source,minimum,{session})=>{
    assert.equal(source,db);assert.ok(session?.draft);
    calls.reservations.push(minimum);
    session.draft.floor = Math.max(session.draft.floor,minimum);
  };
  return {db,client,state,calls,reserveFloor};
}
function equalDocuments(actual,expected) {
  assert.equal(actual.length,expected.length);
  for (let index=0;index<actual.length;index++) assert.deepEqual(BSON.serialize(actual[index]),BSON.serialize(expected[index]));
}

test('backup preserves active and archived records, hidden images, unknown fields and BSON types',async t=>{
  const rows = fixtures();
  const fixture = fakeDatabase(rows);
  const {directory,manifest} = await writeBackup(fixture.db,tempDirectory(t),fingerprint);
  const saved = readBackup(directory);
  equalDocuments(saved.records,rows);
  assert.equal(manifest.count,2);assert.equal(manifest.archived,1);
  assert.equal(manifest.profilePhotos,1);assert.equal(manifest.disabilityDocuments,1);assert.equal(manifest.idPhotos,1);
  assert.equal(manifest.highestRecordNumber,10000);
  assert.equal(saved.records[0].age._bsontype,'Int32');
  assert.equal(saved.records[0].legacyTotal._bsontype,'Long');
  assert.equal(saved.records[0].legacyFraction._bsontype,'Double');
  assert.ok(saved.records[0].createdAt instanceof Date);
  assert.equal(manifest.indexes[1].name,'pwdId_1');
  assert.equal(fixture.calls.deletions.length,0);
});

test('a damaged backup cannot clear records or start a mutation transaction',async t=>{
  const rows = fixtures();const fixture=fakeDatabase(rows);
  const {directory}=await writeBackup(fixture.db,tempDirectory(t),fingerprint);
  const filename=path.join(directory,'records.ejson.gz');
  const bytes=fs.readFileSync(filename);bytes[bytes.length-1]^=1;fs.writeFileSync(filename,bytes);
  assert.throws(()=>readBackup(directory),/checksum/);
  await assert.rejects(clearFromBackup(fixture.db,fixture.client,directory,fingerprint,{reserveFloor:fixture.reserveFloor}),/checksum/);
  equalDocuments(fixture.state.records,rows);
  assert.equal(fixture.calls.sessions.length,0);assert.equal(fixture.calls.deletions.length,0);
});

test('changes or additions after backup prevent clearing any current records',async t=>{
  for (const scenario of ['edited','added']) await t.test(scenario,async t=>{
    const fixture=fakeDatabase(fixtures());
    const {directory}=await writeBackup(fixture.db,tempDirectory(t),fingerprint);
    if (scenario==='edited') fixture.state.records[0].proofOfDisability='new document photo';
    else fixture.state.records.push({_id:new BSON.ObjectId('333333333333333333333333'),pwdId:'PWD-10001',firstName:'New'});
    const before=copyRows(fixture.state.records);
    await assert.rejects(clearFromBackup(fixture.db,fixture.client,directory,fingerprint,{reserveFloor:fixture.reserveFloor}),/changed after the backup/);
    equalDocuments(fixture.state.records,before);
    assert.equal(fixture.calls.deletions.length,0);assert.equal(fixture.calls.reservations.length,0);
    assert.equal(fixture.calls.sessions[0].aborted,true);assert.equal(fixture.calls.sessions[0].ended,true);
  });
});

test('verified clear deletes only backed-up IDs and preserves a higher existing ID floor',async t=>{
  const rows=fixtures();const fixture=fakeDatabase(rows);fixture.state.floor=12000;
  const {directory}=await writeBackup(fixture.db,tempDirectory(t),fingerprint);
  const result=await clearFromBackup(fixture.db,fixture.client,directory,fingerprint,{reserveFloor:fixture.reserveFloor});
  assert.equal(result.deletedCount,2);assert.equal(result.remaining,0);
  assert.deepEqual(fixture.calls.deletions[0]._id.$in.map(String),rows.map(record=>String(record._id)));
  assert.equal(fixture.state.floor,12000);assert.deepEqual(fixture.calls.reservations,[10000]);
  assert.equal(fixture.calls.sessions[0].committed,true);assert.equal(fixture.calls.sessions[0].ended,true);
  assert.ok(fs.readdirSync(directory).some(name=>name.startsWith('clear-receipt-')));
  equalDocuments(readBackup(directory).records,rows);
});

test('a clear count mismatch rolls back deletion and counter changes',async t=>{
  const rows=fixtures();const fixture=fakeDatabase(rows,{deleteCountOffset:-1});fixture.state.floor=99;
  const {directory}=await writeBackup(fixture.db,tempDirectory(t),fingerprint);
  await assert.rejects(clearFromBackup(fixture.db,fixture.client,directory,fingerprint,{reserveFloor:fixture.reserveFloor}),/count mismatch/);
  equalDocuments(fixture.state.records,rows);assert.equal(fixture.state.floor,99);
  assert.equal(fixture.calls.sessions[0].aborted,true);assert.equal(fixture.calls.sessions[0].committed,false);
  assert.ok(!fs.readdirSync(directory).some(name=>name.startsWith('clear-receipt-')));
});

test('restore recreates original BSON documents and rejects a nonempty registry',async t=>{
  const rows=fixtures();const fixture=fakeDatabase(rows);
  const {directory}=await writeBackup(fixture.db,tempDirectory(t),fingerprint);
  await assert.rejects(restoreFromBackup(fixture.db,fixture.client,directory,fingerprint,{reserveFloor:fixture.reserveFloor}),/empty registry/);
  assert.equal(fixture.calls.insertions,0);equalDocuments(fixture.state.records,rows);
  fixture.state.records=[];fixture.state.floor=15000;
  assert.deepEqual(await restoreFromBackup(fixture.db,fixture.client,directory,fingerprint,{reserveFloor:fixture.reserveFloor}),{restoredCount:2});
  equalDocuments(fixture.state.records,rows);assert.equal(fixture.state.floor,15000);
});

test('restore verification failure rolls back inserted documents',async t=>{
  const fixture=fakeDatabase(fixtures(),{corruptInsert:true});
  const {directory}=await writeBackup(fixture.db,tempDirectory(t),fingerprint);
  fixture.state.records=[];
  await assert.rejects(restoreFromBackup(fixture.db,fixture.client,directory,fingerprint,{reserveFloor:fixture.reserveFloor}),/did not match/);
  assert.equal(fixture.state.records.length,0);assert.equal(fixture.state.floor,0);
  assert.equal(fixture.calls.sessions[0].aborted,true);
});

test('clear and restore reject backups from another database or cluster',async t=>{
  const fixture=fakeDatabase(fixtures());
  const {directory}=await writeBackup(fixture.db,tempDirectory(t),fingerprint);
  for (const operation of [clearFromBackup,restoreFromBackup]) {
    await assert.rejects(operation(fixture.db,fixture.client,directory,'another-cluster',{reserveFloor:fixture.reserveFloor}),/different database/);
    fixture.db.databaseName='other-database';
    await assert.rejects(operation(fixture.db,fixture.client,directory,fingerprint,{reserveFloor:fixture.reserveFloor}),/different database/);
    fixture.db.databaseName='backup-test';
  }
  assert.equal(fixture.calls.sessions.length,0);assert.equal(fixture.state.records.length,2);
});

test('empty backup does not delete records subsequently added to the registry',async t=>{
  const fixture=fakeDatabase([]);
  const {directory}=await writeBackup(fixture.db,tempDirectory(t),fingerprint);
  fixture.state.records=fixtures();
  assert.deepEqual(await clearFromBackup(fixture.db,fixture.client,directory,fingerprint,{reserveFloor:fixture.reserveFloor}),{deletedCount:0,remaining:2});
  assert.equal(fixture.calls.sessions.length,0);assert.equal(fixture.calls.deletions.length,0);
});
