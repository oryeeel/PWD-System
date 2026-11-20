const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const {MemoryRouter} = require('react-router-dom');

test('Add Record requires an editable text PWD ID and all four ID card details', async () => {
  const result = await esbuild.build({
    entryPoints:[path.resolve(__dirname,'../src/pages/AddRecord.jsx')],
    bundle:true, platform:'node', format:'cjs', packages:'external', write:false,
    define:{'import.meta.env':'{}'},
    loader:{'.css':'empty'},
  });
  const compiled = new Module(__filename,module);
  compiled.filename = __filename;
  compiled.paths = module.paths;
  compiled._compile(result.outputFiles[0].text,__filename);
  const html = renderToStaticMarkup(React.createElement(MemoryRouter,null,React.createElement(compiled.exports.default)));
  assert.ok(html.includes('Add New Record'));
  const idInput = html.match(/<input\b[^>]*\bname="pwdId"[^>]*>/)?.[0];
  assert.ok(idInput,'The official PWD ID can be entered');
  assert.match(idInput,/type="text"/,'Text input preserves leading zeros');
  assert.match(idInput,/required=""/);
  assert.match(idInput,/value=""/,'No PWD ID is generated or prefilled');
  assert.doesNotMatch(idInput,/readonly|disabled/i);
  for (const label of ['Civil Status','Blood Type','Emergency Contact Name','Emergency Contact Number']) {
    const start = html.indexOf('<label>'+label);
    assert.ok(start >= 0, label+' is visible');
    const field = html.slice(start).split('</label>')[0];
    assert.ok(field.includes('required=""'),label+' is required');
  }
});
