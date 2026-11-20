const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const validRecord = {
  pwdId:'10-0431-000-00001',firstName:'Test',lastName:'Resident',
  civilStatus:'Single',bloodType:'O+',emergencyContactName:'Test Contact',
  emergencyContactPhone:'09123456789',disabilityType:'Physical Disability',
};

function setup(initialRows = []) {
  const rows = initialRows.map(row=>({...row}));
  const calls = {constructed:0,saves:0,updates:0};
  class PwdRecord {
    constructor(values) {calls.constructed++;Object.assign(this,values);}
    async save() {
      calls.saves++;
      if (rows.some(row=>row.pwdId === this.pwdId)) {
        throw Object.assign(new Error('Duplicate PWD ID'),{code:11000,keyPattern:{pwdId:1}});
      }
      const saved = {...this};rows.push(saved);return saved;
    }
    static async findOneAndUpdate(filter,update) {
      calls.updates++;
      const row = rows.find(row=>row.pwdId === filter.pwdId && row.deletedAt == null);
      if (!row) return null;
      Object.assign(row,update.$set);return {...row};
    }
    static get db() {throw new Error('Record creation must not use the automatic ID counter.');}
  }
  const routes = [];
  const app = {use(){},listen(){}};
  for (const method of ['get','post','put','patch','delete']) app[method] = (url,handler)=>routes.push({method,url,handler});
  const express = ()=>app;express.json = ()=>()=>{};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../server.js'),'utf8'),{
    require(name) {
      if (name === 'express') return express;
      if (name === 'mongoose') return {connect:()=>Promise.resolve()};
      if (name === 'cors') return ()=>()=>{};
      if (name === 'dotenv') return {config(){}};
      if (name === 'node:dns') return {setServers(){}};
      if (name === './requestOrigin') return {authenticatedCorsOptions:()=>({})};
      if (name === './models/PwdRecord') return PwdRecord;
      if (name === './recordIds') return require('../recordIds');
      if (name === './routes/documentPhotos') return ()=>{};
      if (name === './archiveRetention') return {startArchiveCleanup(){},purgeExpiredArchives(){}};
      if (name === './sms') return {createSmsHandler:()=>()=>{}};
      if (name === './models/ActivityLog') return {};
      if (name === './models/AuditChainState') return {};
      if (name === './auditIntegrity') return {initializeAuditChain:async()=>{},appendAuditEntry:async()=>{},verifyAuditChain:async()=>({valid:true})};
      if (name === './activityLogs') return {
        actorFrom:()=>null,creatorFor:()=> 'verified.staff',
        createActivityMiddleware:()=>()=>{},createActivityListHandler:()=>()=>{},createActivityIntegrityHandler:()=>()=>{},
      };
      throw new Error(`Unexpected module: ${name}`);
    },process:{env:{}},console:{log(){},error(){}},Date,module:{exports:{}},
  });
  async function request(method,url,body,pwdId) {
    const route = routes.find(route=>route.method === method && route.url === url);
    assert.ok(route,`${method} ${url}`);
    const response = {code:200,status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
    await route.handler({body,params:{pwdId}},response);
    return response;
  }
  return {rows,calls,routes,request};
}

test('creation preserves supplied official IDs as text, including zeros, case and separators',async()=>{
  const fixture = setup();
  for (const pwdId of ['00001234567890123456','10-0431-000-00001','MsWd 001/2026']) {
    const response = await fixture.request('post','/api/records',{...validRecord,pwdId,addedBy:'forged'});
    assert.equal(response.code,201);
    assert.equal(response.data.pwdId,pwdId);
    assert.equal(typeof response.data.pwdId,'string');
    assert.equal(response.data.addedBy,'verified.staff');
  }
  assert.equal(fixture.rows.length,3);
  assert.ok(!fixture.routes.some(route=>route.url === '/api/records/next-id'));
});

test('creation trims only outside whitespace without changing the official ID',async()=>{
  const fixture = setup();
  const response = await fixture.request('post','/api/records',{...validRecord,pwdId:'  00-0123  A  '});
  assert.equal(response.code,201);
  assert.equal(response.data.pwdId,'00-0123  A');
  assert.equal(fixture.rows[0].pwdId,'00-0123  A');
});

test('creation accepts spreadsheet-specific categories in multiple disability records',async()=>{
  const fixture = setup();
  const disabilities=['Cancer (RA11215)','Rare Disease (RA10747)','Mental Disability'];
  const response=await fixture.request('post','/api/records',{...validRecord,pwdId:'10-0431-000-00002',disabilityType:'Multiple Disabilities',disabilities});
  assert.equal(response.code,201);
  assert.deepEqual(Array.from(response.data.disabilities),disabilities);
});

test('missing, numeric, malformed and overlong IDs never construct or save a record',async()=>{
  const fixture = setup();
  for (const pwdId of [undefined,null,'','   ',12345,0,[],{},true,'a'.repeat(101),'12\n34','12\0\x7f34','.','..']) {
    const response = await fixture.request('post','/api/records',{...validRecord,pwdId});
    assert.equal(response.code,400,`ID: ${JSON.stringify(pwdId)}`);
    assert.match(response.data.message,/PWD/i);
  }
  for (const body of [undefined,null,{}]) {
    assert.equal((await fixture.request('post','/api/records',body)).code,400);
  }
  assert.equal(fixture.calls.constructed,0);assert.equal(fixture.calls.saves,0);assert.equal(fixture.rows.length,0);
});

test('duplicate official IDs are rejected for both active and archived records without overwriting',async()=>{
  for (const deletedAt of [null,new Date('2026-01-01')]) {
    const original = {...validRecord,firstName:'Original',deletedAt};
    const fixture = setup([original]);
    const response = await fixture.request('post','/api/records',{...validRecord,firstName:'Replacement'});
    assert.equal(response.code,409);
    assert.match(response.data.message,/already|exists|duplicate/i);
    assert.deepEqual(fixture.rows,[original]);
  }
});

test('concurrent creation of the same official ID yields one saved record and one conflict',async()=>{
  const fixture = setup();
  const responses = await Promise.all([
    fixture.request('post','/api/records',{...validRecord}),
    fixture.request('post','/api/records',{...validRecord}),
  ]);
  assert.deepEqual(responses.map(response=>response.code).sort(),[201,409]);
  assert.equal(fixture.calls.saves,2);assert.equal(fixture.rows.length,1);
});

test('editing refuses reassignment of an existing PWD ID before updating any fields',async()=>{
  const original = {...validRecord,deletedAt:null};
  const fixture = setup([original]);
  for (const pwdId of ['10-0431-000-99999','',null,12345,{}]) {
    const response = await fixture.request('put','/api/records/:pwdId',{...validRecord,pwdId,firstName:'Changed'},original.pwdId);
    assert.equal(response.code,400);
    assert.match(response.data.message,/PWD/i);
  }
  assert.equal(fixture.calls.updates,0);assert.deepEqual(fixture.rows,[original]);
});

test('editing accepts the same or omitted PWD ID while preserving the stored identifier',async()=>{
  const fixture = setup([{...validRecord,deletedAt:null}]);
  const same = await fixture.request('put','/api/records/:pwdId',{...validRecord,firstName:'Updated'},validRecord.pwdId);
  assert.equal(same.code,200);assert.equal(same.data.pwdId,validRecord.pwdId);
  const {pwdId,...withoutId} = validRecord;
  const omitted = await fixture.request('put','/api/records/:pwdId',{...withoutId,firstName:'Updated Again'},pwdId);
  assert.equal(omitted.code,200);assert.equal(omitted.data.pwdId,pwdId);
  assert.equal(fixture.rows[0].firstName,'Updated Again');
});
