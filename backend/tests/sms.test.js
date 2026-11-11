const {test} = require('node:test');
const assert = require('node:assert/strict');
const {normalizePhone, createSmsHandler} = require('../sms');

const body = {recipientIds:['PWD-DEMO'],message:'Demo appointment reminder'};
const env = {IPROG_API_TOKEN:'fake-test-token'};
function response() {
  return {code:200,status(code){this.code=code;return this},json(data){this.data=data;return this}};
}
function setup(overrides = {}) {
  let calls = 0;
  const handler = createSmsHandler({env,model:{findOne:async filter => {
    assert.equal(filter.deletedAt,null);
    return {contact:'09171234567'};
  }},send:async (url,options) => {
    calls++;
    assert.equal(url,'https://www.iprogsms.com/api/v1/sms_messages');
    assert.deepEqual(JSON.parse(options.body),{api_token:env.IPROG_API_TOKEN,phone_number:'639171234567',message:body.message});
    return {ok:true,json:async()=>({status:200,message_id:'demo-1'})};
  },...overrides});
  return {handler,calls:()=>calls};
}
async function call(handler, submitted=body, address='127.0.0.1') {
  const res=response();
  await handler({body:submitted,socket:{remoteAddress:address}},res);
  return res;
}
test('normalizes Philippine phone formats and rejects invalid numbers',()=>{
  for (const phone of ['09171234567','9171234567','+63 917 123 4567']) assert.equal(normalizePhone(phone),'639171234567');
  assert.equal(normalizePhone('123'),null);
});

test('shared cooldown refuses a send before contacting IPROG',async()=>{
  const {handler,calls}=setup({acquireSendSlot:async()=>false});
  assert.equal((await call(handler)).code,429);
  assert.equal(calls(),0);
});

test('authenticated remote staff can send through the provider without local-only restriction',async()=>{
  const {handler,calls}=setup();
  const res=response();
  await handler({body,socket:{remoteAddress:'203.0.113.10'},authUser:{role:'Staff'}},res);
  assert.equal(res.code,200);
  assert.equal(calls(),1);
});
test('sends SMS to the selected record contact, returns queued rather than delivered, and prevents rapid repeats',async()=>{
  const {handler,calls}=setup();
  const result=await call(handler);
  assert.equal(result.code,200);
  assert.equal(result.data.status,'Queued');
  assert.equal(result.data.providerMessageId,'demo-1');
  assert.equal((await call(handler)).code,429);
  assert.equal(calls(),1);
});
test('blocks unconfigured, remote, multi-recipient and invalid-contact sends without provider calls',async()=>{
  for (const [overrides,submitted,address,expected] of [
    [{env:{}},body,'127.0.0.1',503],
    [{},body,'192.168.1.5',403],
    [{},{...body,recipientIds:['a','b']},'127.0.0.1',400],
    [{},{...body,message:' '},'127.0.0.1',400],
    [{model:{findOne:async()=>({contact:'invalid'})}},body,'127.0.0.1',400],
    [{model:{findOne:async()=>null}},body,'127.0.0.1',400],
  ]) {
    const {handler,calls}=setup(overrides);
    assert.equal((await call(handler,submitted,address)).code,expected);
    assert.equal(calls(),0);
  }
});
test('provider rejection and uncertain network results never report success',async()=>{
  for (const send of [async()=>({ok:true,json:async()=>({status:400})}),async()=>{throw new Error('timeout')}]) {
    const {handler}=setup({send});
    assert.equal((await call(handler)).code,502);
    assert.equal((await call(handler)).code,429);
  }
});

test('uses the selected record phone without a separate demo phone setting', async () => {
  let target;
  const {handler} = setup({model:{findOne:async()=>({contact:'09991234567'})},send:async(url,options)=>{
    target=JSON.parse(options.body).phone_number;
    return {ok:true,json:async()=>({status:200,message_id:'demo-2'})};
  }});
  assert.equal((await call(handler)).code,200);
  assert.equal(target,'639991234567');
});

test('shows the provider rejection reason without exposing credentials or phone numbers', async () => {
  const {handler}=setup({send:async()=>({ok:false,json:async()=>({status:422,message:`Template approval required for 639171234567 ${env.IPROG_API_TOKEN}`})})});
  const result=await call(handler);
  assert.equal(result.code,502);
  assert.match(result.data.message,/Template approval required/);
  assert.ok(!result.data.message.includes(env.IPROG_API_TOKEN));
  assert.ok(!result.data.message.includes('639171234567'));
});

test('extracts structured provider errors instead of returning a generic rejection', async () => {
  const {handler}=setup({send:async()=>({ok:false,status:422,json:async()=>({errors:{template:['An approved template is required.']}})})});
  const result=await call(handler);
  assert.match(result.data.message,/An approved template is required/);
});
