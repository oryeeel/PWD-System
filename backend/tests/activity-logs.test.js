const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {actorFrom,creatorFor,actionFor,createActivityMiddleware,createActivityListHandler,createActivityIntegrityHandler} = require('../activityLogs');
const staff = {id:2,username:'staff1',fullname:'MSWDO Staff 1',role:'Staff'};
const header = actor => ({'x-pwd-actor':encodeURIComponent(JSON.stringify(actor))});
test('record creator uses the signed-in staff identity instead of a hardcoded body value',()=>{
  assert.equal(creatorFor({headers:header(staff),body:{addedBy:'Admin'}}),'staff1');
  assert.equal(creatorFor({headers:header({...staff,id:3,username:'staff2'}),body:{addedBy:'Admin'}}),'staff2');
  assert.equal(creatorFor({headers:{},body:{addedBy:'Admin'}}),'Unknown');
});
function response() {
  return Object.assign(new EventEmitter(),{statusCode:200,status(code){this.statusCode=code;return this},json(data){this.data=data;return this}});
}
test('records successful staff actions with actor and record ID, excluding request content',async()=>{
  const saved=[];
  const req={headers:header(staff),method:'PUT',path:'/api/records/PWD-0001',body:{contact:'private',bloodType:'private'}};
  const res=response();
  createActivityMiddleware({create:async log=>saved.push(log)})(req,res,()=>{});
  res.json({pwdId:'PWD-0001'});res.emit('finish');
  await Promise.resolve();
  assert.deepEqual(saved,[{staffId:'2',username:'staff1',staffName:'MSWDO Staff 1',actorRole:'Staff',action:'Updated record',recordId:'PWD-0001'}]);
});
test('does not record failed requests, admins, missing sessions or unrelated reads',async()=>{
  const saved=[];
  for(const [actor,status,path] of [[staff,400,'/api/records'],[{...staff,role:'Admin'},200,'/api/records'],[null,200,'/api/records'],[staff,200,'/api/records/next-id']]){
    const req={headers:actor?header(actor):{},method:'GET',path};
    const res=response();res.statusCode=status;
    createActivityMiddleware({create:async log=>saved.push(log)})(req,res,()=>{});
    res.emit('finish');
  }
  await Promise.resolve();assert.equal(saved.length,0);
});
test('captures document photo updates even when a mounted router rewrites the path',async()=>{
  const saved=[];
  const req={headers:header(staff),method:'PATCH',path:'/api/records/PWD-0001/document-photos/pwdIdPhoto',originalUrl:'/api/records/PWD-0001/document-photos/pwdIdPhoto?source=record',body:{image:'private'}};
  const res=response();
  createActivityMiddleware({create:async log=>saved.push(log)})(req,res,()=>{});
  req.path='/pwdIdPhoto';
  res.json({pwdIdPhoto:'private'});res.emit('finish');
  await Promise.resolve();
  assert.equal(saved.length,1);
  assert.equal(saved[0].action,'Updated document photo');
  assert.equal(saved[0].recordId,'PWD-0001');
  assert.equal(saved[0].detail,'PWD ID photo');
});
test('admin can filter activity by exact staff username',async()=>{
  let filter;
  const chain={sort(){return this},skip(){return this},limit(){return this},lean:async()=>[]};
  const model={countDocuments:async value=>{filter=value;return 0},find:()=>chain};
  const res=response();
  await createActivityListHandler(model)({headers:header({...staff,role:'Admin'}),query:{staff:'staff2'}},res);
  assert.deepEqual(filter,{username:'staff2'});
  assert.equal(res.statusCode,200);
});
test('activity filter combines exact action with staff and date filters',async()=>{
  let filter;
  const chain={sort(){return this},skip(){return this},limit(){return this},lean:async()=>[]};
  const model={countDocuments:async value=>{filter=value;return 0},find:value=>{assert.deepEqual(value,filter);return chain}};
  const res=response();
  await createActivityListHandler(model)({headers:header({...staff,role:'Admin'}),query:{activity:'Viewed record',staff:'staff2',from:'2026-10-24'}},res);
  assert.equal(res.statusCode,200);
  assert.deepEqual(filter,{action:'Viewed record',username:'staff2',createdAt:{$gte:new Date('2026-10-24T00:00:00+08:00')}});
});

test('activity logs can filter administrator password reset audit actions',async()=>{
  let filter;
  const chain={sort(){return this},skip(){return this},limit(){return this},lean:async()=>[]};
  const model={countDocuments:async value=>{filter=value;return 0},find:value=>{assert.deepEqual(value,filter);return chain}};
  const res=response();
  await createActivityListHandler(model)({headers:header({...staff,role:'Admin'}),query:{activity:'Reset staff password'}},res);
  assert.equal(res.statusCode,200);
  assert.deepEqual(filter,{action:'Reset staff password'});
});

test('activity logs include current Admin and Staff actors, excluding deleted accounts',async()=>{
  let filter;
  const chain={sort(){return this},skip(){return this},limit(){return this},lean:async()=>[]};
  const model={countDocuments:async value=>{filter=value;return 0},find:value=>{assert.deepEqual(value,filter);return chain}};
  const userModel={find(value){assert.deepEqual(value,{role:{$in:['Admin','Staff']}});return {select(fields){assert.equal(fields,'_id');return {lean:async()=>[{_id:'current-admin-id'},{_id:'current-staff-id'}]}}}}};
  const res=response();
  await createActivityListHandler(model,null,userModel)({headers:header({...staff,role:'Admin'}),query:{}},res);
  assert.equal(res.statusCode,200);
  assert.deepEqual(filter,{staffId:{$in:['current-admin-id','current-staff-id']}});
});

test('maps archive, restore, creation, photos and SMS to clear actions',()=>{
  for(const [method,path,action] of [['POST','/api/records/PWD-0001/recycle','Archived record'],['POST','/api/recycle-bin/PWD-0001/restore','Restored record'],['POST','/api/records','Added record'],['PATCH','/api/records/PWD-0001/document-photos/pwdIdPhoto','Updated document photo'],['POST','/api/messages/send','Submitted SMS']]){
    assert.equal(actionFor({method,path,body:{recipientIds:['PWD-0001']}},{pwdId:'PWD-0001',status:'Queued',providerMessageId:'mock-id'}).action,action);
  }
});
test('SMS batch audit preserves per-outcome totals without claiming delivery or storing content',async()=>{
  const saved=[];
  const req={headers:header(staff),method:'POST',path:'/api/messages/send',
    body:{recipientIds:['PWD-0001','PWD-0002','PWD-0003','PWD-0004'],message:'private announcement'},activityWrites:[]};
  const res=response();
  createActivityMiddleware({},console,async log=>saved.push(log))(req,res,()=>{});
  res.json({status:'Partial',counts:{selected:4,unique:3,duplicates:1,submitted:1,failed:1,unknown:1,notSent:0},
    results:[{phoneNumber:'639000000001',status:'Queued',providerMessageId:'mock-1'},
      {phoneNumber:'639000000002',status:'Failed',message:'private provider error'},
      {phoneNumber:'639000000003',status:'Unknown'}]});
  res.emit('finish');
  await Promise.all(req.activityWrites);
  assert.equal(saved.length,1);
  assert.equal(saved[0].action,'Submitted SMS');
  assert.equal(saved[0].recordId,'');
  assert.match(saved[0].detail,/1 submitted to IPROG; 1 failed; 1 unconfirmed; 0 not sent/);
  assert.match(saved[0].detail,/1 duplicate numbers skipped/);
  assert.match(saved[0].detail,/Delivery not confirmed/);
  assert.match(saved[0].detail,/PWD-0001, PWD-0002, PWD-0003, PWD-0004/);
  assert.ok(!JSON.stringify(saved).includes('private'));
  assert.ok(!JSON.stringify(saved).includes('639000000001'));
});
test('failed SMS batches are audited honestly and replayed results do not create duplicate activity',async()=>{
  const saved=[];
  const payload={status:'Failed',counts:{selected:1,unique:1,duplicates:0,submitted:0,failed:1,unknown:0,notSent:0},results:[{status:'Failed'}]};
  for (const replayed of [false,true]) {
    const req={authUser:staff,method:'POST',path:'/api/messages/send',body:{recipientIds:['PWD-0001']},activityWrites:[]};
    const res=response();
    createActivityMiddleware({},console,async log=>saved.push(log))(req,res,()=>{});
    res.json({...payload,replayed});res.emit('finish');
    await Promise.all(req.activityWrites);
  }
  assert.equal(saved.length,1);
  assert.equal(saved[0].recordId,'PWD-0001');
  assert.match(saved[0].detail,/0 submitted to IPROG; 1 failed/);
  assert.equal(actionFor({method:'POST',path:'/api/messages/send',body:{}},{}),null);
});
test('actual SMS handler deduplicates numbers and writes one audit entry across a replay',async()=>{
  const {createSmsHandler} = require('../sms');
  let providerCalls=0;
  const logs=[];
  const rows=[{pwdId:'PWD-QA-1',contact:'09000000001'},{pwdId:'PWD-QA-2',contact:'+63 900 000 0001'},
    {pwdId:'PWD-QA-3',contact:'09000000002'}];
  const handler=createSmsHandler({env:{IPROG_API_TOKEN:'fake-unit-token'},
    model:{find:async()=>rows},send:async()=>{
      providerCalls++;
      return providerCalls === 1 ? {ok:true,status:200,json:async()=>({status:200,message_id:'mock-accepted'})}
        : {ok:false,status:422,json:async()=>({status:422,message:'Rejected test template'})};
    }});
  for (let attempt=0;attempt<2;attempt++) {
    const req={authUser:staff,method:'POST',path:'/api/messages/send',activityWrites:[],
      body:{requestId:'audit-integration-test-request',recipientIds:rows.map(row=>row.pwdId),message:'Fixture notification'}};
    const res=response();
    createActivityMiddleware({},console,async entry=>logs.push(entry))(req,res,()=>{});
    await handler(req,res);res.emit('finish');await Promise.all(req.activityWrites);
    assert.equal(res.data.status,'Partial');
    assert.equal(res.data.replayed,attempt === 1);
  }
  assert.equal(providerCalls,2);
  assert.equal(logs.length,1);
  assert.match(logs[0].detail,/3 selected; 2 unique numbers; 1 submitted to IPROG; 1 failed/);
  assert.match(logs[0].detail,/1 duplicate numbers skipped/);
});
test('staff cannot read activity logs and malformed actors are rejected',async()=>{
  assert.equal(actorFrom({headers:{'x-pwd-actor':'bad-json'}}),null);
  const res=response();
  await createActivityListHandler({})({headers:header(staff),query:{}},res);
  assert.equal(res.statusCode,403);
});
test('only admins can run activity log integrity verification',async()=>{
  let verified=false;
  const handler=createActivityIntegrityHandler(async()=>{verified=true;return {valid:true,legacyEntries:1,chainedEntries:0,latestSequence:0}});
  const adminResponse=response();
  await handler({headers:header({...staff,role:'Admin'})},adminResponse);
  assert.equal(adminResponse.statusCode,200);assert.equal(adminResponse.data.valid,true);assert.equal(verified,true);
  verified=false;
  const staffResponse=response();
  await handler({headers:header(staff)},staffResponse);
  assert.equal(staffResponse.statusCode,403);assert.equal(verified,false);
});
test('admin search uses literal text, Philippine dates, newest-first pagination',async()=>{
  let filter;
  const chain={sort(value){assert.deepEqual(value,{createdAt:-1,_id:-1});return this},skip(value){assert.equal(value,20);return this},limit(value){assert.equal(value,20);return this},lean:async()=>[{action:'Updated record'}]};
  const model={countDocuments:async value=>{filter=value;return 25},find:value=>{assert.deepEqual(value,filter);return chain}};
  const res=response();
  await createActivityListHandler(model)({headers:header({...staff,role:'Admin'}),query:{search:'staff.*',page:'2',from:'2026-10-24',to:'2026-10-24'}},res);
  assert.equal(res.statusCode,200);
  assert.equal(filter.$or[0].staffName.$regex,'staff\\.\\*');
  assert.equal(filter.createdAt.$gte.toISOString(),'2026-10-23T16:00:00.000Z');
  assert.equal(res.data.pages,2);assert.equal(res.data.logs.length,1);
});
test('activity list resolves names for affected records and retains missing record IDs',async()=>{
  const logs=[{action:'Viewed record',recordId:'PWD-0001'},{action:'Added record',recordId:'PWD-9999'},{action:'Signed in',recordId:''}];
  const chain={sort(){return this},skip(){return this},limit(){return this},lean:async()=>logs};
  const recordModel={find(filter){assert.deepEqual(filter,{pwdId:{$in:['PWD-0001','PWD-9999']}});return {select(fields){assert.equal(fields,'pwdId firstName middleName lastName');return {lean:async()=>[{pwdId:'PWD-0001',firstName:'Althea',middleName:'Reyes',lastName:'Mendoza'}]}}}}};
  const res=response();
  await createActivityListHandler({countDocuments:async()=>3,find:()=>chain},recordModel)({headers:header({...staff,role:'Admin'}),query:{}},res);
  assert.equal(res.statusCode,200);
  assert.equal(res.data.logs[0].recordName,'Althea Reyes Mendoza');
  assert.equal(res.data.logs[1].recordName,'');
  assert.equal(res.data.logs[1].recordId,'PWD-9999');
  assert.equal(res.data.logs[2].recordName,'');
});

test('page size is bounded and requests beyond the last page are clamped',async()=>{
  for (const [requested,size] of [['50',50],['100',100],['100000',20],['invalid',20]]) {
    const pages=Math.ceil(969/size);
    const chain={sort(){return this},skip(value){assert.equal(value,(pages-1)*size);return this},limit(value){assert.equal(value,size);return this},lean:async()=>[]};
    const model={countDocuments:async()=>969,find:()=>chain};
    const res=response();
    await createActivityListHandler(model)({headers:header({...staff,role:'Admin'}),query:{page:'999',pageSize:requested}},res);
    assert.equal(res.data.pageSize,size);
    assert.equal(res.data.pages,pages);
    assert.equal(res.data.page,pages);
  }
});
