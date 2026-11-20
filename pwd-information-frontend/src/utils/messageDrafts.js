const templates = [
  {
    id:'default-draft-announcement-v1',
    title:'Announcement draft',
    type:'Announcement',
    message:'MSWDO Villanueva reminds PWD constituents to keep their registry details updated. Visit or contact our office during regular office hours for assistance. Thank you.',
  },
  {
    id:'default-draft-schedule-v1',
    title:'Schedule draft',
    type:'Schedule',
    message:'MSWDO Villanueva: Your [service/appointment] is scheduled for [date] at [time] at [venue]. Contact our office if you need assistance or to reschedule.',
  },
  {
    id:'default-draft-interview-v1',
    title:'Interview draft',
    type:'Interview',
    message:'MSWDO Villanueva: Your PWD registration interview is on [date] at [time]. Please arrive 15 minutes early and bring the required documents. Contact us for assistance.',
  },
  {
    id:'default-draft-reminder-v1',
    title:'Reminder draft',
    type:'Reminder',
    message:'Reminder from MSWDO Villanueva: Your [appointment/requirement] is due on [date]. Please bring the required documents. Contact our office for assistance.',
  },
]

const previousTemplateMessages = new Map([
  ['default-draft-announcement-v1','MSWDO Villanueva announcement: [Add announcement details]. For assistance, contact our office.'],
  ['default-draft-schedule-v1','MSWDO Villanueva: [Service or event] is scheduled on [date] at [time] at [venue]. Please contact our office if you need assistance.'],
  ['default-draft-interview-v1','MSWDO Villanueva: Your interview is scheduled on [date] at [time]. Please arrive 15 minutes early and bring the required documents.'],
  ['default-draft-reminder-v1','Reminder from MSWDO Villanueva: [Add reminder details]. Please contact our office if you need assistance.'],
])

export function seedDefaultMessageDrafts(messages,seeded,atIso=new Date().toISOString()) {
  if (seeded) return {messages,seeded:false}
  const existingIds = new Set(messages.map(item => String(item.id)))
  const templatesById = new Map(templates.map(item => [item.id,item]))
  const updatedMessages = messages.map(item => {
    const template = templatesById.get(item.id)
    if (!template || item.status !== 'Draft' || item.message !== previousTemplateMessages.get(item.id) || item.recipientIds?.length) return item
    return {...item,title:template.title,type:template.type,message:template.message}
  })
  const drafts = templates.filter(item => !existingIds.has(item.id)).map(item => ({
    ...item,recipientIds:[],recipientCount:0,status:'Draft',atIso,
  }))
  return {messages:[...drafts,...updatedMessages],seeded:true}
}
