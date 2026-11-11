const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../api/index.js'),'utf8');
function load(app){
  const context={require:()=>app,module:{exports:{}},Promise};
  vm.runInNewContext(source,context);
  return context.module.exports;
}
test('Vercel adapter waits for the database and audit writes',async()=>{
  let ready=false,written=false;
  const app=(req,res)=>{
    assert.equal(ready,true);
    res.once('finish',()=>req.activityWrites.push(Promise.resolve().then(()=>{written=true})));
    res.emit('finish');
  };
  app.databaseReady=Promise.resolve().then(()=>{ready=true});
  await load(app)({},new EventEmitter());
  assert.equal(written,true);
});
test('Vercel adapter refuses requests when database setup fails',async()=>{
  let called=false;
  const app=()=>{called=true};app.databaseReady=Promise.reject(new Error('private connection details'));
  const res={status(code){this.code=code;return this},json(body){this.body=body}};
  await load(app)({},res);
  assert.equal(called,false);assert.equal(res.code,503);
  assert.ok(!res.body.message.includes('private'));
});
