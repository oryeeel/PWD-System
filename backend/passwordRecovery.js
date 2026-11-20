const crypto = require('node:crypto');
const {passwordError} = require('./passwordPolicy');

function passwordResetDigest(secret, value) {
  return crypto.createHmac('sha256',secret).update(value).digest('hex');
}

function generateOtp() {
  return String(crypto.randomInt(100000,1000000));
}

function generateResetToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateTemporaryPassword() {
  const groups = ['ABCDEFGHJKLMNPQRSTUVWXYZ','abcdefghijkmnopqrstuvwxyz','23456789','!@#$%_-'];
  const characters = groups.map(group => group[crypto.randomInt(group.length)]);
  const alphabet = groups.join('');
  while (characters.length < 16) characters.push(alphabet[crypto.randomInt(alphabet.length)]);
  for (let index = characters.length - 1; index > 0; index--) {
    const swap = crypto.randomInt(index + 1);
    [characters[index],characters[swap]] = [characters[swap],characters[index]];
  }
  const password = characters.join('');
  if (passwordError(password)) throw new Error('Could not generate a valid temporary password.');
  return password;
}

function isPasswordEmailConfigured(env) {
  const port = Number(env.SMTP_PORT);
  if (env.SMTP_SECURE !== undefined && !['true','false'].includes(env.SMTP_SECURE)) return false;
  return Boolean(env.SMTP_HOST && Number.isInteger(port) && port > 0 && port < 65536 &&
    env.SMTP_USER && env.SMTP_PASS && env.SMTP_FROM);
}

function createPasswordResetMailer(env) {
  if (!isPasswordEmailConfigured(env)) return async () => {throw new Error('Password recovery email is not configured.');};
  const nodemailer = require('nodemailer');
  const port = Number(env.SMTP_PORT);
  const transporter = nodemailer.createTransport({
    host:env.SMTP_HOST,
    port,
    secure:env.SMTP_SECURE === 'true' || port === 465,
    auth:{user:env.SMTP_USER,pass:env.SMTP_PASS},
  });
  return (email,otp) => transporter.sendMail({
    from:env.SMTP_FROM,
    to:email,
    subject:'PWD System - Password Reset Verification',
    text:`You requested to reset your password for the PWD Registry and Information Management System.\n\nYour verification code is: ${otp}\n\nThis code will expire in 5 minutes.\n\nIf you did not request this password reset, please ignore this email.`,
  });
}

function createAdminLoginMailer(env) {
  if (!isPasswordEmailConfigured(env)) return async () => {throw new Error('Admin sign-in email is not configured.');};
  const nodemailer = require('nodemailer');
  const port = Number(env.SMTP_PORT);
  const transporter = nodemailer.createTransport({
    host:env.SMTP_HOST,
    port,
    secure:env.SMTP_SECURE === 'true' || port === 465,
    auth:{user:env.SMTP_USER,pass:env.SMTP_PASS},
  });
  return (email,otp) => transporter.sendMail({
    from:env.SMTP_FROM,
    to:email,
    subject:'PWD System - Admin Sign-in Verification',
    text:`Your Admin sign-in verification code for the PWD Registry and Information Management System is: ${otp}\n\nThis code will expire in 5 minutes. If you did not attempt to sign in, please ignore this email.`,
  });
}

module.exports = {
  passwordResetDigest,generateOtp,generateResetToken,generateTemporaryPassword,
  isPasswordEmailConfigured,createPasswordResetMailer,createAdminLoginMailer,
};
