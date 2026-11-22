const {test} = require('node:test')
const assert = require('node:assert/strict')

test('SMS activity displays submission outcomes instead of claiming delivery', async () => {
  const {activityDescription} = await import('../src/utils/activityDescription.js')
  const detail = '2 selected; 1 submitted to IPROG; 1 failed. Delivery not confirmed.'
  assert.equal(activityDescription({action:'Submitted SMS',detail}),`SMS submission: ${detail}`)
  assert.equal(activityDescription({action:'Submitted SMS',recordId:'PWD-TEST'}),'SMS submission for PWD-TEST (delivery not confirmed)')
  assert.equal(activityDescription({action:'Updated record',recordId:'PWD-TEST'}),'Updated record PWD-TEST')
})
