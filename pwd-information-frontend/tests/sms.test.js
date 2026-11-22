import {test} from 'node:test'
import assert from 'node:assert/strict'
import {MAX_SMS_RECIPIENTS,normalizeSmsPhone,selectedSmsRecipients,toggleRecipientIds,selectMatchingRecipientIds,estimateSms,validateSms,smsPayloadKey,readPendingSms,PENDING_SMS_KEY,smsResultSummary,smsConfirmation} from '../src/utils/sms.js'

const records = [
  {pwdId:'TEST-1',firstName:'Test',middleName:'A',lastName:'One',contact:'09170000001'},
  {pwdId:'TEST-2',firstName:'Test',lastName:'Two',contact:'+63 917 000 0002'},
  {pwdId:'TEST-3',firstName:'Shared',lastName:'Number',contact:'+63 917 000 0001'},
  {pwdId:'TEST-4',firstName:'Invalid',lastName:'Number',contact:'123'},
]
const form = {type:'Announcement',recipientIds:['TEST-1','TEST-2'],message:'Test announcement'}

test('selection, deselection and X removal keep a unique list without changing beneficiary data',()=>{
  const before = structuredClone(records)
  let ids = toggleRecipientIds([],'TEST-1')
  ids = toggleRecipientIds(ids,'TEST-2')
  assert.deepEqual(ids,['TEST-1','TEST-2'])
  assert.deepEqual(selectedSmsRecipients(ids,records).map(record => [record.name,record.contact]),[['Test A One','09170000001'],['Test Two','+63 917 000 0002']])
  ids = toggleRecipientIds(ids,'TEST-1')
  assert.deepEqual(ids,['TEST-2'])
  ids = toggleRecipientIds(ids,'TEST-2')
  assert.deepEqual(selectedSmsRecipients(ids,records),[])
  assert.deepEqual(records,before)
})

test('filtered select all adds matching records once and deselects only matches',()=>{
  assert.deepEqual(selectMatchingRecipientIds(['TEST-1'],['TEST-1','TEST-2'],true),['TEST-1','TEST-2'])
  assert.deepEqual(selectMatchingRecipientIds(['TEST-1','TEST-2','TEST-3'],['TEST-1','TEST-2'],false),['TEST-3'])
  assert.deepEqual(selectMatchingRecipientIds(['TEST-3'],[],true),['TEST-3'])
})

test('phone validation accepts Philippine forms and deduplicates normalized numbers for usage',()=>{
  for (const phone of ['09170000001','9170000001','+63 917-000-0001','(63917) 000 0001']) assert.equal(normalizeSmsPhone(phone),'639170000001')
  for (const phone of ['','123','091700000001','+1 917 000 0001','0917abc00001','02 81234567']) assert.equal(normalizeSmsPhone(phone),null)
  const selected = selectedSmsRecipients(['TEST-1','TEST-3','TEST-1'],records)
  assert.equal(selected.length,2)
  assert.equal(new Set(selected.map(recipient => recipient.phoneNumber)).size,1)
})

test('invalid/missing recipients and empty or excessive messages fail validation before any send',()=>{
  assert.equal(validateSms(form,selectedSmsRecipients(form.recipientIds,records)),'')
  assert.match(validateSms({...form,message:'  '},selectedSmsRecipients(form.recipientIds,records)),/Enter a message/)
  assert.match(validateSms(form,[]),/at least one recipient/)
  assert.match(validateSms({...form,message:'x'.repeat(481)},selectedSmsRecipients(form.recipientIds,records)),/480/)
  assert.match(validateSms(form,selectedSmsRecipients(['TEST-4'],records)),/Invalid Number/)
  const missing = selectedSmsRecipients(['REMOVED-RECORD'],records)
  assert.equal(missing[0].missing,true)
  assert.match(validateSms(form,missing),/REMOVED-RECORD/)
  assert.match(validateSms(form,Array.from({length:MAX_SMS_RECIPIENTS+1},(_,i) => ({pwdId:`test-${i}`,phoneNumber:'639170000001'}))),/20 recipients/)
})

test('SMS estimate accounts for basic GSM, extension characters and multipart boundaries',()=>{
  assert.deepEqual(estimateSms(''),{encoding:'GSM-7',units:0,segments:0})
  assert.deepEqual(estimateSms('a'.repeat(160)),{encoding:'GSM-7',units:160,segments:1})
  assert.equal(estimateSms('a'.repeat(161)).segments,2)
  assert.equal(estimateSms('a'.repeat(306)).segments,2)
  assert.equal(estimateSms('a'.repeat(307)).segments,3)
  assert.equal(estimateSms('^'.repeat(80)).segments,1)
  assert.equal(estimateSms('^'.repeat(81)).segments,2)
  assert.deepEqual(estimateSms('[]{}~\\^|€'),{encoding:'GSM-7',units:18,segments:1})
  assert.equal(estimateSms('^'.repeat(153)).segments,3,'an extension escape sequence cannot be split across segments')
})

test('Unicode SMS estimate counts UTF-16 units and multipart limits',()=>{
  assert.deepEqual(estimateSms('漢'.repeat(70)),{encoding:'Unicode',units:70,segments:1})
  assert.equal(estimateSms('漢'.repeat(71)).segments,2)
  assert.equal(estimateSms('漢'.repeat(134)).segments,2)
  assert.equal(estimateSms('漢'.repeat(135)).segments,3)
  assert.deepEqual(estimateSms('😀'.repeat(35)),{encoding:'Unicode',units:70,segments:1})
  assert.equal(estimateSms('😀'.repeat(36)).segments,2)
})

test('confirmation states selected and unique counts, message, estimates and shared-number handling',()=>{
  const selected = selectedSmsRecipients(['TEST-1','TEST-2','TEST-3'],records)
  const text = smsConfirmation({...form,message:'漢'.repeat(71)},selected)
  assert.match(text,/3 selected recipient\(s\) at 2 unique phone number\(s\)/)
  assert.ok(text.includes('漢'.repeat(71)))
  assert.match(text,/2 segment\(s\) per number × 2 number\(s\) = 4 segment/)
  assert.match(text,/sharing a phone number receive only one message/)
  assert.match(text,/does not confirm delivery/)
})

test('pending submissions survive reload with the same request ID and canonical payload',()=>{
  const pending = {requestId:'test-request-id',submitted:form,editingId:'draft-id'}
  const storage = {getItem(key) {assert.equal(key,PENDING_SMS_KEY);return JSON.stringify(pending)}}
  assert.deepEqual(readPendingSms(storage),pending)
  assert.equal(smsPayloadKey(form),smsPayloadKey({...form,recipientIds:['TEST-2','TEST-1','TEST-1'],message:' Test announcement '}))
  assert.notEqual(smsPayloadKey(form),smsPayloadKey({...form,message:'Another announcement'}))
  assert.equal(readPendingSms({getItem:()=>'{invalid'}),null)
  assert.equal(readPendingSms({getItem:()=>JSON.stringify({requestId:'broken'})}),null)
})

test('submission summary does not conflate unknown or unattempted messages with failures or delivery',()=>{
  assert.equal(smsResultSummary({submitted:2,failed:1,unknown:1,notSent:3}),'2 submitted, 1 failed, 1 unconfirmed, 3 not sent.')
})
