export const MAX_SMS_RECIPIENTS = 20
export const MAX_SMS_CHARACTERS = 480
export const PENDING_SMS_KEY = 'pwd_pending_sms_v1'

export function normalizeSmsPhone(value) {
  const phone = String(value || '').replace(/[\s()+-]/g, '')
  if (/^09\d{9}$/.test(phone)) return `63${phone.slice(1)}`
  if (/^9\d{9}$/.test(phone)) return `63${phone}`
  return /^639\d{9}$/.test(phone) ? phone : null
}

export function recipientName(record) {
  return [record?.firstName,record?.middleName,record?.lastName,record?.suffix].filter(Boolean).join(' ') || record?.pwdId || 'Unavailable recipient'
}

export function toggleRecipientIds(selected, id) {
  return selected.includes(id) ? selected.filter(value => value !== id) : [...new Set([...selected,id])]
}

export function selectMatchingRecipientIds(selected, matching, checked) {
  const ids = new Set(matching)
  return checked ? [...new Set([...selected,...ids])] : selected.filter(id => !ids.has(id))
}

export function selectedSmsRecipients(recipientIds, records) {
  const byId = new Map(records.map(record => [record.pwdId,record]))
  return [...new Set(recipientIds)].map(pwdId => {
    const record = byId.get(pwdId)
    return {pwdId,name:recipientName(record || {pwdId}),contact:record?.contact || '',phoneNumber:normalizeSmsPhone(record?.contact),missing:!record}
  })
}

const gsmBasic = new Set('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà')
const gsmExtension = new Set('\f^{}\\[~]|€')

export function estimateSms(message) {
  const text = String(message || '').trim()
  let units = 0
  let encoding = 'GSM-7'
  for (const character of text) {
    if (gsmBasic.has(character)) units++
    else if (gsmExtension.has(character)) units += 2
    else {encoding = 'Unicode';units = text.length;break}
  }
  const single = encoding === 'GSM-7' ? 160 : 70
  const multipart = encoding === 'GSM-7' ? 153 : 67
  let segments = units === 0 ? 0 : 1
  if (units > single) {
    let used = 0
    for (const character of text) {
      const width = encoding === 'GSM-7' ? (gsmExtension.has(character) ? 2 : 1) : character.length
      if (used + width > multipart) {segments++;used = 0}
      used += width
    }
  }
  return {encoding,units,segments}
}

export function validateSms(form, recipients) {
  if (!form.message.trim()) return 'Enter a message before sending.'
  if (form.message.trim().length > MAX_SMS_CHARACTERS) return `Keep the message to ${MAX_SMS_CHARACTERS} characters or fewer.`
  if (!recipients.length) return 'Select at least one recipient before sending.'
  if (recipients.length > MAX_SMS_RECIPIENTS) return `Select no more than ${MAX_SMS_RECIPIENTS} recipients per batch.`
  const invalid = recipients.filter(recipient => !recipient.phoneNumber || recipient.missing)
  if (invalid.length) return `Remove recipients with an unavailable record or invalid Philippine mobile number before sending: ${invalid.map(recipient => recipient.name).join(', ')}.`
  return ''
}

export function smsPayloadKey(form) {
  return JSON.stringify({recipientIds:[...new Set(form.recipientIds)].sort(),message:form.message.trim()})
}

export function readPendingSms(storage) {
  try {
    const pending = JSON.parse(storage.getItem(PENDING_SMS_KEY) || 'null')
    return pending && typeof pending.requestId === 'string' && Array.isArray(pending.submitted?.recipientIds) && typeof pending.submitted?.message === 'string' ? pending : null
  } catch {return null}
}

export function smsResultSummary(counts) {
  return `${counts.submitted} submitted, ${counts.failed} failed, ${counts.unknown} unconfirmed, ${counts.notSent} not sent.`
}

export function smsConfirmation(form, recipients) {
  const unique = new Set(recipients.map(recipient => recipient.phoneNumber)).size
  const usage = estimateSms(form.message)
  return `Submit this ${form.type.toLowerCase()} to ${recipients.length} selected recipient(s) at ${unique} unique phone number(s)?\n\n${form.message.trim()}\n\nEstimated SMS usage: ${usage.segments} segment(s) per number × ${unique} number(s) = ${usage.segments * unique} segment(s) (${usage.encoding}).${unique < recipients.length ? '\nRecipients sharing a phone number receive only one message.' : ''}\nIPROG headers and encoding may increase credit usage. Submission does not confirm delivery.`
}
