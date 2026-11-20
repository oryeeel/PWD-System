const {test} = require('node:test')
const assert = require('node:assert/strict')

test('PWD IDs sort by numeric segments and retain a deterministic order for zero-padded ties',async()=>{
  const {comparePwdIds} = await import('../src/utils/pwdIdSort.js')
  const ids = ['PWD-10','PWD-2','PWD-0002','PWD-1']
  assert.deepEqual(ids.sort(comparePwdIds),['PWD-1','PWD-0002','PWD-2','PWD-10'])
})

test('multi-part PWD IDs sort each numeric segment naturally',async()=>{
  const {comparePwdIds} = await import('../src/utils/pwdIdSort.js')
  const ids = ['10-0431-000-00002','10-0431-000-00010','10-0431-000-00001','2-0001-000-00001']
  assert.deepEqual(ids.sort(comparePwdIds),['2-0001-000-00001','10-0431-000-00001','10-0431-000-00002','10-0431-000-00010'])
})
