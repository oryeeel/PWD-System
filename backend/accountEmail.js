// Normalize ordinary mailbox addresses without conflating Gmail aliases.
// Validation checks syntax only; it does not verify ownership or delivery.
function normalizeEmail(value) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254) return null;
  const parts = email.split('@');
  if (parts.length !== 2) return null;
  const [local,domain] = parts;
  if (!local || local.length > 64 || !/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+$/.test(local) ||
      local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null;
  const labels = domain.split('.');
  if (labels.length < 2 || labels.some(label=>!label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null;
  return email;
}

function duplicateAccountMessage(error) {
  return error.keyPattern?.email || error.keyValue?.email !== undefined
    ? 'Email address already belongs to another account.' : 'Username already exists.';
}

module.exports = {normalizeEmail,duplicateAccountMessage};
