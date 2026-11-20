
const crypto = require('node:crypto');
const {passwordError} = require('./passwordPolicy');

function passwordResetDigest(secret, value) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function generateResetToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateTemporaryPassword() {
  const groups = [
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    'abcdefghijkmnopqrstuvwxyz',
    '23456789',
    '!@#$%_-',
  ];

  const characters = groups.map(
    group => group[crypto.randomInt(group.length)]
  );

  const alphabet = groups.join('');

  while (characters.length < 16) {
    characters.push(alphabet[crypto.randomInt(alphabet.length)]);
  }

  for (let index = characters.length - 1; index > 0; index--) {
    const swap = crypto.randomInt(index + 1);

    [characters[index], characters[swap]] =
      [characters[swap], characters[index]];
  }

  const password = characters.join('');

  if (passwordError(password)) {
    throw new Error('Could not generate a valid temporary password.');
  }

  return password;
}

// Check whether either Resend or SMTP is configured.
function isPasswordEmailConfigured(env) {
  if (typeof env.RESEND_API_KEY === 'string' &&
      env.RESEND_API_KEY.trim() &&
      typeof env.RESEND_FROM === 'string' &&
      env.RESEND_FROM.trim()) {
    return true;
  }

  const port = Number(env.SMTP_PORT);

  if (
    env.SMTP_SECURE !== undefined &&
    !['true', 'false'].includes(env.SMTP_SECURE)
  ) {
    return false;
  }

  return Boolean(
    env.SMTP_HOST &&
    Number.isInteger(port) &&
    port > 0 &&
    port < 65536 &&
    env.SMTP_USER &&
    env.SMTP_PASS &&
    env.SMTP_FROM
  );
}

// Send email using Resend HTTPS API.
function createResendMailer(env) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.RESEND_FROM;

  return async (email, subject, message) => {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject,
        text: message,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.error(
        'Resend email delivery failed. HTTP status:',
        response.status
      );

      throw new Error('Email delivery failed.');
    }
  };
}

// Keep Gmail SMTP for local development.
function createSmtpMailer(env) {
  const nodemailer = require('nodemailer');
  const port = Number(env.SMTP_PORT);

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: env.SMTP_SECURE === 'true' || port === 465,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });

  return (email, subject, message) =>
    transporter.sendMail({
      from: env.SMTP_FROM,
      to: email,
      subject,
      text: message,
    });
}

// Choose Resend when configured; otherwise use SMTP.
function createEmailMailer(env) {
  if (env.RESEND_API_KEY && env.RESEND_FROM) {
    return createResendMailer(env);
  }

  if (isPasswordEmailConfigured(env)) {
    return createSmtpMailer(env);
  }

  return async () => {
    throw new Error('Email delivery is not configured.');
  };
}

// Password recovery verification emails.
function createPasswordResetMailer(env) {
  const sendEmail = createEmailMailer(env);

  return (email, otp) => sendEmail(
    email,
    'PWD System - Password Reset Verification',
    `You requested to reset your password for the PWD Registry and Information Management System.

Your verification code is: ${otp}

This code will expire in 5 minutes.

If you did not request this password reset, please ignore this email.`
  );
}

// Admin MFA verification emails.
function createAdminLoginMailer(env) {
  const sendEmail = createEmailMailer(env);

  return (email, otp) => sendEmail(
    email,
    'PWD System - Admin Sign-in Verification',
    `Your Admin sign-in verification code for the PWD Registry and Information Management System is: ${otp}

This code will expire in 5 minutes.

If you did not attempt to sign in, please ignore this email.`
  );
}

module.exports = {
  passwordResetDigest,
  generateOtp,
  generateResetToken,
  generateTemporaryPassword,
  isPasswordEmailConfigured,
  createPasswordResetMailer,
  createAdminLoginMailer,
};
