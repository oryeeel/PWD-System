// Keep these rules aligned with backend/accountEmail.js and accountUsername.js.
export function normalizeEmail(value) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return null
  const email = value.trim().toLowerCase()
  if (!email || email.length > 254) return null
  const parts = email.split('@')
  if (parts.length !== 2) return null
  const [local,domain] = parts
  if (!local || local.length > 64 || !/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+$/.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null
  const labels = domain.split('.')
  if (labels.length < 2 || labels.some(label => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null
  return email
}

export function normalizeUsername(value) {
  return normalizeEmail(value) || (typeof value === 'string' && /^[a-zA-Z0-9_.-]{3,50}$/.test(value) ? value : null)
}
