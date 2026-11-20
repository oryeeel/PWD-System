const {test} = require('node:test')
const assert = require('node:assert/strict')

test('default drafts cover each message type with no recipients selected',async()=>{
  const {seedDefaultMessageDrafts} = await import('../src/utils/messageDrafts.js')
  const result=seedDefaultMessageDrafts([],false,'2026-11-20T00:00:00.000Z')
  assert.deepEqual(result.messages.map(item=>item.type),['Announcement','Schedule','Interview','Reminder'])
  assert.ok(result.messages.every(item=>item.status==='Draft'&&item.recipientIds.length===0&&item.recipientCount===0))
  assert.ok(result.messages.every(item=>item.atIso==='2026-11-20T00:00:00.000Z'))
})

test('draft seeding preserves saved messages and does not add templates twice',async()=>{
  const {seedDefaultMessageDrafts} = await import('../src/utils/messageDrafts.js')
  const saved={id:'existing-draft',type:'Reminder',status:'Draft',recipientIds:[],message:'Existing draft'}
  const first=seedDefaultMessageDrafts([saved],false,'2026-11-20T00:00:00.000Z')
  assert.equal(first.messages.at(-1),saved)
  const second=seedDefaultMessageDrafts(first.messages,true,'2026-11-21T00:00:00.000Z')
  assert.equal(second.messages.length,first.messages.length)
  assert.equal(second.messages.filter(item=>item.type==='Reminder').length,2)
})

test('updated defaults replace only untouched drafts from the previous template version',async()=>{
  const {seedDefaultMessageDrafts} = await import('../src/utils/messageDrafts.js')
  const oldDraft={id:'default-draft-announcement-v1',title:'Announcement draft',type:'Announcement',message:'MSWDO Villanueva announcement: [Add announcement details]. For assistance, contact our office.',recipientIds:[],recipientCount:0,status:'Draft',atIso:'2026-11-20T00:00:00.000Z'}
  const editedDraft={...oldDraft,id:'default-draft-reminder-v1',type:'Reminder',message:'My edited reminder'}
  const result=seedDefaultMessageDrafts([oldDraft,editedDraft],false,'2026-11-20T00:00:00.000Z')
  assert.notEqual(result.messages.find(item=>item.id===oldDraft.id).message,oldDraft.message)
  assert.equal(result.messages.find(item=>item.id===editedDraft.id).message,'My edited reminder')
})
