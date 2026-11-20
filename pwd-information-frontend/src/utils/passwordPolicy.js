// Keep these rules aligned with backend/passwordPolicy.js.
export const PASSWORD_REQUIREMENTS = 'Use 8-20 characters, including uppercase, lowercase, a number, and a special character.'

export function passwordError(value) {
  if (typeof value !== 'string') return 'Enter a password.'
  const length = Array.from(value).length
  if (length < 8 || length > 20) return 'Use a password of 8-20 characters.'
  if (new TextEncoder().encode(value).length > 72) return 'Use a password of at most 72 UTF-8 bytes. Some characters use more than one byte.'
  if (!/[A-Z]/.test(value)) return 'Include at least one uppercase letter (A-Z).'
  if (!/[a-z]/.test(value)) return 'Include at least one lowercase letter (a-z).'
  if (!/[0-9]/.test(value)) return 'Include at least one number (0-9).'
  if (!/[\p{P}\p{S}]/u.test(value)) return 'Include at least one special character, such as !, @, or #.'
  return ''
}
