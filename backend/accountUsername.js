const {normalizeEmail} = require('./accountEmail');

function normalizeUsername(value) {
  const email = normalizeEmail(value);
  if (email) return email;
  return typeof value === 'string' && /^[a-zA-Z0-9_.-]{3,50}$/.test(value) ? value : null;
}

module.exports = {normalizeUsername};
