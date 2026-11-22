const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createSmsHandler,createMemorySubmissionStore,normalizePhone} = require('../sms');

// All calls are intercepted below. These fictional numbers never reach a network.
const env = {IPROG_API_TOKEN:'test-token-never-real'};
const body = {requestId:'sms-test-request-0001',recipientIds:['PWD-1'],message:'Appointment reminder'};
const record = (index,contact = `0900000${String(index).padStart(4,'0')}`) => ({pwdId:`PWD-${index}`,contact});
const accepted = id => ({ok:true,status:200,json:async()=>({status:200,message_id:id})});
function response() {
  return {code:200,status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
}
function setup(options = {}) {
  const calls = [];
  const rows = options.rows || [record(1),record(2),record(3)];
  let queries = 0;
  const handler = createSmsHandler({env,now:()=>100000,
    model:{find:async filter => {
      queries++;
      assert.equal(filter.deletedAt,null);
      return rows.filter(row=>filter.pwdId.$in.includes(row.pwdId) && !row.deletedAt);
    }},...options,
    send:async (url,config) => {
      const payload = JSON.parse(config.body);
      calls.push(payload);
      assert.equal(url,'https://www.iprogsms.com/api/v1/sms_messages');
      assert.equal(config.method,'POST');
      assert.equal(payload.api_token,env.IPROG_API_TOKEN);
      assert.ok(config.signal instanceof AbortSignal);
      return options.send ? options.send(url,config,payload) : accepted(`provider-${payload.phone_number}`);
    },
  });
  return {handler,calls,queries:()=>queries,rows};
}
async function call(handler,submitted = body,extra = {}) {
  const res = response();
  await handler({body:submitted,socket:{remoteAddress:'127.0.0.1'},...extra},res);
  return res;
}

test('normalizes local and international Philippine mobile formats only',()=>{
  for (const value of ['09000000001','9000000001','+63 900 000 0001','(0900) 000-0001']) assert.equal(normalizePhone(value),'639000000001');
  for (const value of ['',null,'123','08900000001','+1 9000000001','09000000001ext2']) assert.equal(normalizePhone(value),null);
});

test('one SMS is submitted with a provider ID, never reported as delivered',async()=>{
  const fixture = setup();
  const result = await call(fixture.handler,{...body,message:'  Appointment reminder  '});
  assert.equal(result.code,200);
  assert.equal(result.data.status,'Queued');
  assert.equal(result.data.providerMessageId,'provider-639000000001');
  assert.deepEqual(result.data.counts,{selected:1,unique:1,duplicates:0,submitted:1,failed:0,unknown:0,notSent:0});
  assert.equal(fixture.calls[0].message,body.message);
  assert.match(result.data.message,/not confirmation of delivery/);
  assert.ok(!JSON.stringify(result.data).includes(env.IPROG_API_TOKEN));
});

test('multiple selected records receive individual provider requests without modifying records',async()=>{
  const fixture = setup();
  const original = structuredClone(fixture.rows);
  const result = await call(fixture.handler,{...body,recipientIds:['PWD-1','PWD-2','PWD-3']});
  assert.equal(result.data.counts.submitted,3);
  assert.deepEqual(fixture.calls.map(item=>item.phone_number),['639000000001','639000000002','639000000003']);
  assert.deepEqual(fixture.rows,original);
});

test('shared contact numbers and repeated IDs never cause duplicate provider calls',async()=>{
  const fixture = setup({rows:[record(1),record(2,'+63 900 000 0001'),record(3)]});
  const result = await call(fixture.handler,{...body,recipientIds:['PWD-1','PWD-2','PWD-1','PWD-3']});
  assert.deepEqual(result.data.counts,{selected:3,unique:2,duplicates:1,submitted:2,failed:0,unknown:0,notSent:0});
  assert.equal(fixture.calls.length,2);
  assert.deepEqual(result.data.results[0].recipientIds,['PWD-1','PWD-2']);
});

test('invalid bodies, empty messages, missing recipients and oversized batches never send',async()=>{
  for (const submitted of [
    {},{...body,recipientIds:[]},{...body,recipientIds:'PWD-1'},
    {...body,recipientIds:[null]},{...body,recipientIds:[' ']},{...body,recipientIds:['a'.repeat(101)]},
    {...body,recipientIds:Array.from({length:21},(_,index)=>`PWD-${index}`)},
    {...body,message:' '},{...body,message:42},{...body,message:'x'.repeat(481)},
    {...body,requestId:'short'},{...body,requestId:{forged:true}},
  ]) {
    const fixture = setup();
    assert.equal((await call(fixture.handler,submitted)).code,400);
    assert.equal(fixture.calls.length,0);
  }
});

test('validates all contacts and archived/missing records before submitting any SMS',async()=>{
  for (const rows of [[record(1),record(2,'invalid')],[record(1)],[record(1),{...record(2),deletedAt:new Date()}]]) {
    const fixture = setup({rows});
    const result = await call(fixture.handler,{...body,recipientIds:['PWD-1','PWD-2']});
    assert.equal(result.code,400);
    assert.deepEqual(result.data.invalidRecipientIds,['PWD-2']);
    assert.equal(fixture.calls.length,0);
  }
});

test('remote unauthenticated requests and unconfigured providers are rejected',async()=>{
  const remote = setup();
  assert.equal((await call(remote.handler,body,{socket:{remoteAddress:'203.0.113.1'}})).code,403);
  assert.equal(remote.calls.length,0);
  const disabled = setup({env:{}});
  assert.equal((await call(disabled.handler)).code,503);
  assert.equal(disabled.calls.length,0);
});

test('authenticated remote Staff can send',async()=>{
  const fixture = setup();
  assert.equal((await call(fixture.handler,body,{socket:{remoteAddress:'203.0.113.1'},authUser:{role:'Staff',id:'staff-1'}})).code,200);
  assert.equal(fixture.calls.length,1);
});

test('legacy clients without request IDs still receive a receipt and cooldown protection',async()=>{
  const fixture = setup();
  const {requestId,...legacy} = body;
  const result = await call(fixture.handler,legacy);
  assert.match(result.data.requestId,/^[a-f0-9-]{36}$/);
  assert.equal((await call(fixture.handler,legacy)).code,429);
  assert.equal(fixture.calls.length,1);
});

test('same request replays indefinitely even after beneficiary data changes',async()=>{
  let timestamp = 100000;
  const fixture = setup({now:()=>timestamp});
  const first = await call(fixture.handler);
  fixture.rows.length = 0;
  timestamp += 7 * 24 * 60 * 60 * 1000;
  const replay = await call(fixture.handler);
  assert.equal(replay.data.replayed,true);
  assert.deepEqual(replay.data.results,first.data.results);
  assert.equal(fixture.calls.length,1);
  assert.equal(fixture.queries(),1);
});

test('an existing request ID cannot be reused for different content or actor',async()=>{
  const fixture = setup();
  await call(fixture.handler);
  for (const submitted of [{...body,message:'Changed text'},{...body,recipientIds:['PWD-2']}]) assert.equal((await call(fixture.handler,submitted)).code,409);
  assert.equal((await call(fixture.handler,body,{authUser:{role:'Staff',id:'another-staff'}})).code,409);
  assert.equal(fixture.calls.length,1);
});

test('global cooldown also prevents different request IDs from rapid resubmission',async()=>{
  let timestamp = 100000;
  const fixture = setup({now:()=>timestamp});
  await call(fixture.handler);
  const second = {...body,requestId:'sms-test-request-0002'};
  assert.equal((await call(fixture.handler,second)).code,429);
  timestamp += 60000;
  assert.equal((await call(fixture.handler,second)).code,200);
  assert.equal(fixture.calls.length,2);
});

test('concurrent duplicate requests remain pending and cannot call the provider twice',async()=>{
  let release;
  let started;
  const providerStarted = new Promise(resolve=>{started=resolve;});
  const fixture = setup({send:async()=>{started();await new Promise(resolve=>{release=resolve;});return accepted('concurrent');}});
  const first = call(fixture.handler);
  await providerStarted;
  const second = await call(fixture.handler);
  assert.equal(second.code,409);
  assert.equal(second.data.pending,true);
  assert.equal((await call(fixture.handler,{...body,requestId:'sms-test-request-0002'})).code,429);
  release();
  await first;
  assert.equal((await call(fixture.handler)).data.replayed,true);
  assert.equal(fixture.calls.length,1);
});

test('separate handler instances share cooldown and replay reservations',async()=>{
  const submissionStore = createMemorySubmissionStore();
  const first = setup({submissionStore});
  const second = setup({submissionStore});
  await call(first.handler);
  assert.equal((await call(second.handler)).data.replayed,true);
  assert.equal((await call(second.handler,{...body,requestId:'sms-test-request-0002'})).code,429);
  assert.equal(second.calls.length,0);
});

test('provider rejections are failed while timeouts and ambiguous responses remain unknown',async()=>{
  for (const [send,status] of [
    [async()=>({ok:false,status:422,json:async()=>({errors:{message:['Rejected template']}})}),'Failed'],
    [async()=>({ok:true,status:200,json:async()=>({status:400})}),'Failed'],
    [async()=>{throw new Error('timeout');},'Unknown'],
    [async()=>({ok:false,status:500,json:async()=>({status:500})}),'Unknown'],
    [async()=>({ok:true,status:200,json:async()=>({status:200})}),'Unknown'],
    [async()=>({ok:true,status:200,json:async()=>{throw new Error('Malformed JSON');}}),'Unknown'],
  ]) {
    const fixture = setup({send});
    const result = await call(fixture.handler);
    assert.equal(result.code,200);
    assert.equal(result.data.status,status);
    assert.equal(result.data.counts.submitted,0);
    assert.equal((await call(fixture.handler)).data.replayed,true);
    assert.equal(fixture.calls.length,1);
  }
});

test('mixed provider results report submitted, failed and unknown separately',async()=>{
  const fixture = setup({send:async(url,config,payload)=>{
    if (payload.phone_number.endsWith('1')) return accepted('accepted-1');
    if (payload.phone_number.endsWith('2')) return {ok:false,status:422,json:async()=>({message:'Rejected'})};
    throw new Error('Network disconnected');
  }});
  const result = await call(fixture.handler,{...body,recipientIds:['PWD-1','PWD-2','PWD-3']});
  assert.equal(result.data.status,'Partial');
  assert.deepEqual(result.data.counts,{selected:3,unique:3,duplicates:0,submitted:1,failed:1,unknown:1,notSent:0});
});

test('provider secrets cannot leak through error details or message IDs',async()=>{
  for (const send of [
    async()=>({ok:false,status:422,json:async()=>({errors:{template:[`Approval required ${env.IPROG_API_TOKEN} 639000000001`]}})}),
    async()=>accepted(`id-${env.IPROG_API_TOKEN}`),
  ]) {
    const fixture = setup({send});
    const result = await call(fixture.handler);
    assert.ok(!JSON.stringify(result.data).includes(env.IPROG_API_TOKEN));
    assert.equal(result.data.counts.submitted,0);
    if (result.data.status === 'Failed') {
      assert.match(result.data.results[0].message,/Approval required/);
      assert.ok(!result.data.results[0].message.includes('639000000001'));
    }
  }
});

test('provider concurrency is bounded to three for the maximum batch',async()=>{
  let active = 0;
  let peak = 0;
  const rows = Array.from({length:20},(_,index)=>record(index + 1));
  const fixture = setup({rows,send:async(url,config,payload)=>{
    active++;peak=Math.max(peak,active);
    await new Promise(resolve=>setTimeout(resolve,2));
    active--;
    return accepted(payload.phone_number);
  }});
  const result = await call(fixture.handler,{...body,recipientIds:rows.map(row=>row.pwdId)});
  assert.equal(result.data.counts.submitted,20);
  assert.equal(peak,3);
});

test('batch deadline leaves unstarted recipients NotSent and never retries them',async()=>{
  let timestamp = 100000;
  const fixture = setup({now:()=>timestamp,concurrency:1,send:async()=>{timestamp+=8000;return accepted('accepted');}});
  const result = await call(fixture.handler,{...body,recipientIds:['PWD-1','PWD-2','PWD-3']});
  assert.equal(result.data.counts.submitted,2);
  assert.equal(result.data.counts.notSent,1);
  assert.equal(result.data.results[2].status,'NotSent');
  assert.equal(fixture.calls.length,2);
  await call(fixture.handler,{...body,recipientIds:['PWD-1','PWD-2','PWD-3']});
  assert.equal(fixture.calls.length,2);
});

test('provider request has an abort timeout and uncertainty does not trigger retry',async()=>{
  const fixture = setup({providerTimeoutMs:5,send:async(url,config)=>{
    await new Promise((resolve,reject)=>{
      const keepAlive = setTimeout(resolve,100);
      config.signal.addEventListener('abort',()=>{clearTimeout(keepAlive);reject(config.signal.reason);},{once:true});
    });
    return accepted('too-late');
  }});
  const result = await call(fixture.handler);
  assert.equal(result.data.counts.unknown,1);
  assert.equal(fixture.calls.length,1);
});

test('unavailable records or durable safeguards fail closed before provider calls',async()=>{
  for (const options of [
    {model:{find:async()=>{throw new Error('private database connection');}}},
    {submissionStore:{claim:async()=>{throw new Error('private database connection');}}},
    {getSubmissionStore:()=>{throw new Error('private initialization failure');}},
  ]) {
    const fixture = setup(options);
    const result = await call(fixture.handler);
    assert.equal(result.code,503);
    assert.ok(!JSON.stringify(result.data).includes('private'));
    assert.equal(fixture.calls.length,0);
  }
});

test('lost result persistence returns receipt and later recovers Unknown without resending',async()=>{
  let timestamp = 100000;
  const store = createMemorySubmissionStore();
  const fixture = setup({now:()=>timestamp,submissionStore:{...store,finish:async()=>{throw new Error('Database offline');}}});
  const result = await call(fixture.handler);
  assert.equal(result.data.counts.submitted,1);
  assert.equal(result.data.persistenceWarning,true);
  assert.equal((await call(fixture.handler)).code,409);
  timestamp+=30000;
  const recovered = await call(fixture.handler);
  assert.equal(recovered.code,200);
  assert.equal(recovered.data.status,'Unknown');
  assert.equal(recovered.data.counts.unknown,1);
  assert.deepEqual(recovered.data.results[0].recipientIds,['PWD-1']);
  assert.equal(fixture.calls.length,1);
});

test('a slow reservation consumes the sending budget instead of extending it',async()=>{
  let timestamp = 100000;
  const store = createMemorySubmissionStore();
  const fixture = setup({now:()=>timestamp,submissionStore:{...store,claim:async params=>{const value=await store.claim(params);timestamp+=21000;return value;}}});
  const result = await call(fixture.handler);
  assert.equal(result.data.counts.notSent,1);
  assert.equal(fixture.calls.length,0);
});
