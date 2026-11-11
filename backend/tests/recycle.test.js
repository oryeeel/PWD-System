const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('recycle and restore preserve records, hide recycled records, and reserve IDs', async () => {
  const saved = {pwdId:'PWD-0002',firstName:'Test',lastName:'Resident',status:'Inactive',photo:'original-photo',createdAt:'2025-01-01'};
  const rows = [{pwdId:'PWD-0001'}, {...saved}];
  const matches = (row,filter) => Object.entries(filter).every(([key,value]) =>
    value && typeof value === 'object' && '$ne' in value ? row[key] != null : value === null ? row[key] == null : row[key] === value);
  const model = {
    deleteMany: async filter => {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].deletedAt instanceof Date && rows[i].deletedAt <= filter.deletedAt.$lte) rows.splice(i, 1);
      }
    },
    find: (filter={}) => ({sort: async () => rows.filter(row => matches(row,filter))}),
    findOne: (filter) => filter ? Promise.resolve(rows.find(row => matches(row,filter))) : {sort: async () => rows.at(-1)},
    findOneAndUpdate: async (filter,update) => {
      const row=rows.find(row => matches(row,filter));
      if(row) Object.assign(row,update.$set);
      return row;
    },
  };
  const routes=[];
  const app={use(){},listen(){}};
  for (const method of ['get','post','put','patch','delete']) app[method]=(url,handler) => routes.push({method,url,handler});
  const express=() => app;express.json=() => () => {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../server.js'),'utf8'),{
    require(name) {
      if(name==='express') return express;
      if(name==='mongoose') return {connect:() => Promise.resolve()};
      if(name==='cors') return () => () => {};
      if(name==='dotenv') return {config(){}};
      if(name==='node:dns') return {setServers(){}};
      if(name==='./models/PwdRecord') return model;
      if(name==='./routes/documentPhotos') return () => {};
      if(name==='./archiveRetention') return {...require('../archiveRetention'), startArchiveCleanup(){}};
      if(name==='./sms') return {createSmsHandler: () => () => {}};
      if(name==='./models/ActivityLog') return {};
      if(name==='./activityLogs') return {actorFrom:()=>null,createActivityMiddleware:()=>()=>{},createActivityListHandler:()=>()=>{}};
      throw new Error(name);
    },process:{env:{}},console:{log(){},error(){}},Date,module:{exports:{}},
  });
  async function call(method,url,body={}) {
    const route=routes.find(route => route.method===method && route.url===url);
    assert.ok(route,`${method} ${url}`);
    const res={code:200,status(code){this.code=code;return this},json(data){this.data=data}};
    await route.handler({params:{pwdId:saved.pwdId},body},res);
    return res;
  }
  assert.equal((await call('get','/api/records')).data.length,2); // Legacy records with no deletedAt remain active.
  assert.equal((await call('post','/api/records/:pwdId/recycle')).code,200);
  assert.equal(rows.length,2);
  assert.equal((await call('get','/api/records')).data.length,1);
  assert.equal((await call('get','/api/recycle-bin')).data.length,1);
  assert.equal((await call('get','/api/records/:pwdId')).code,404);
  assert.equal((await call('put','/api/records/:pwdId',{civilStatus:'Single',bloodType:'O+',emergencyContactName:'Test Contact',emergencyContactPhone:'09123456789'})).code,404);
  assert.equal((await call('post','/api/records/:pwdId/view')).code,404);
  assert.equal((await call('patch','/api/records/:pwdId/photo',{photo:'data:image/png;base64,AAAA'})).code,404);
  assert.equal((await call('post','/api/records/:pwdId/recycle')).code,404);
  assert.equal((await call('get','/api/records/next-id')).data.pwdId,'PWD-0003');
  assert.ok(routes.findIndex(r=>r.url==='/api/records/next-id') < routes.findIndex(r=>r.url==='/api/records/:pwdId'));
  assert.equal((await call('post','/api/recycle-bin/:pwdId/restore')).code,200);
  assert.equal((await call('get','/api/recycle-bin')).data.length,0);
  assert.equal((await call('get','/api/records')).data.length,2);
  for(const [key,value] of Object.entries(saved)) assert.equal(rows[1][key],value);
  assert.equal((await call('post','/api/recycle-bin/:pwdId/restore')).code,404);
  assert.equal((await call('delete','/api/records/:pwdId')).code,200);
  assert.equal(rows.length,2); // Old clients also soft-delete.
  rows.find(row => row.pwdId === saved.pwdId).deletedAt = new Date('2000-01-01');
  assert.equal((await call('post','/api/recycle-bin/:pwdId/restore')).code,404);
  assert.equal(rows.length,1); // Expired archives cannot be restored.
  rows.push({pwdId:'PWD-0003',deletedAt:new Date('2000-01-01')});
  assert.equal((await call('get','/api/recycle-bin')).data.length,0);
  assert.equal(rows.length,1); // Listing the archive also purges expired entries.
});
