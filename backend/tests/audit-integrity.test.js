const {test} = require('node:test');
const assert = require('node:assert/strict');
const {initializeAuditChain,appendAuditEntry,verifyAuditChain} = require('../auditIntegrity');

function fixture() {
  const key='test-only-audit-key-with-at-least-thirty-two-bytes';
  const entries=[
    {_id:'legacy-1',staffId:'staff-1',username:'staff',staffName:'Staff',action:'Added record',recordId:'PWD-1',detail:'',createdAt:new Date('2026-01-01T00:00:00.000Z')},
    {_id:'legacy-2',staffId:'staff-2',username:'staff2',staffName:'Staff Two',action:'Viewed record',recordId:'PWD-2',detail:'',createdAt:new Date('2026-01-02T00:00:00.000Z')},
  ];
  let state=null;
  const matches=(entry,filter)=>{
    const [field,condition]=Object.entries(filter)[0];
    if(condition && typeof condition==='object' && '$exists' in condition)return (field in entry)===condition.$exists;
    return entry[field]===condition;
  };
  const ActivityLog={
    collection:{
      countDocuments:async filter=>entries.filter(entry=>matches(entry,filter)).length,
      find(filter){return {sort(){return this},toArray:async()=>entries.filter(entry=>matches(entry,filter)).sort((a,b)=>{
        const first=a.chainSequence ?? a.createdAt.getTime();
        const second=b.chainSequence ?? b.createdAt.getTime();
        return first-second || String(a._id).localeCompare(String(b._id));
      })}},
    },
    db:{startSession:async()=>({withTransaction:async callback=>callback(),endSession:async()=>{}})},
    async create(docs){const saved=docs.map((entry,index)=>({_id:`new-${entries.length+index+1}`,...entry}));entries.push(...saved);return saved;},
  };
  const AuditChainState={
    findById(){
      const query={session(){return this},lean:async()=>state && {...state}};
      return query;
    },
    async create(value){state={...value};return state;},
    async updateOne(filter,update){
      if(!state || state.sequence!==filter.sequence || state.lastHash!==filter.lastHash)return {modifiedCount:0};
      Object.assign(state,update.$set);return {modifiedCount:1};
    },
  };
  return {key,entries,ActivityLog,AuditChainState};
}

test('baseline preserves existing audit entries and the HMAC chain detects later edits',async()=>{
  const {key,entries,ActivityLog,AuditChainState}=fixture();
  await initializeAuditChain(ActivityLog,AuditChainState,key,new Date('2026-01-03T00:00:00.000Z'));
  assert.equal(entries.length,2);
  assert.deepEqual(await verifyAuditChain(ActivityLog,AuditChainState,key),{
    valid:true,legacyEntries:2,chainedEntries:0,latestSequence:0,
  });

  await appendAuditEntry(ActivityLog,AuditChainState,key,{
    staffId:'staff-1',username:'staff',staffName:'Staff',actorRole:'Staff',
    action:'Signed in',
  });
  assert.deepEqual(await verifyAuditChain(ActivityLog,AuditChainState,key),{
    valid:true,legacyEntries:2,chainedEntries:1,latestSequence:1,
  });
  entries[2].action='Deleted record';
  const result=await verifyAuditChain(ActivityLog,AuditChainState,key);
  assert.equal(result.valid,false);assert.equal(result.reason,'chain_mismatch');
});

test('the legacy baseline detects modifications without rewriting existing records',async()=>{
  const {key,entries,ActivityLog,AuditChainState}=fixture();
  await initializeAuditChain(ActivityLog,AuditChainState,key);
  entries[0].action='Updated record';
  const result=await verifyAuditChain(ActivityLog,AuditChainState,key);
  assert.equal(result.valid,false);assert.equal(result.reason,'baseline_mismatch');
});

test('initialization refuses to replace a deleted chain state or accept a different key',async()=>{
  const {key,entries,ActivityLog,AuditChainState}=fixture();
  await initializeAuditChain(ActivityLog,AuditChainState,key);
  await assert.rejects(initializeAuditChain(ActivityLog,AuditChainState,'a-different-audit-key-with-at-least-thirty-two-bytes'),/does not match/i);

  const missingState=fixture();
  missingState.entries[2]={_id:'chained-1',chainSequence:1,previousHash:'hash',entryHash:'hash',createdAt:new Date()};
  await assert.rejects(initializeAuditChain(missingState.ActivityLog,missingState.AuditChainState,key),/state is missing/i);
});
