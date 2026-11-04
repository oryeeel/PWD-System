export function activityDescription(log) {
  const record = log.recordId ? log.recordName ? `${log.recordName} (${log.recordId})` : log.recordId : ''
  const action = log.action || 'Activity'
  if (!record || ['Signed in','Signed out'].includes(action)) return action
  if (action === 'Submitted SMS') return `Sent SMS to ${record}`
  if (action === 'Updated document photo') {
    const document = ['Proof of disability','PWD ID photo'].includes(log.detail) ? log.detail.toLowerCase() : 'document photo'
    return `Updated ${document} for ${record}`
  }
  if (['Updated profile photo','Viewed ID card'].includes(action)) return `${action} for ${record}`
  return `${action} ${record}`
}
