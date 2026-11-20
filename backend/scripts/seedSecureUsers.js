const dns = require('node:dns');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const readline = require('node:readline/promises');
const {Writable} = require('node:stream');
const {stdin,stdout} = require('node:process');
const {User} = require('../auth');
const {normalizeEmail,duplicateAccountMessage} = require('../accountEmail');
const {normalizeUsername} = require('../accountUsername');
const {passwordError,PASSWORD_REQUIREMENTS} = require('../passwordPolicy');
require('dotenv').config({quiet:true});

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is missing from backend/.env.');
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Run this setup in an interactive terminal so you can enter the password privately.');

  let muted = false;
  const output = new Writable({write(chunk,encoding,done) {
    if (muted) done();else stdout.write(chunk,encoding,done);
  }});
  const rl = readline.createInterface({input:stdin,output,terminal:true});
  async function passwordQuestion(prompt) {
    stdout.write(prompt);
    muted = true;
    try {return await rl.question('');}
    finally {muted = false;stdout.write('\n');}
  }

  try {
    console.log('Create a new administrator. Existing accounts will be preserved.');
    const username = normalizeUsername((await rl.question('Admin username: ')).trim());
    const fullname = (await rl.question('Full name: ')).trim();
    const email = normalizeEmail(await rl.question('Email address (Gmail is supported): '));
    if (!username) throw new Error('Use a valid email address or a username of 3-50 letters, numbers, underscores, dots, or hyphens.');
    if (!fullname || fullname.length > 150) throw new Error('Enter a full name of up to 150 characters.');
    if (!email) throw new Error('Enter a valid email address.');
    console.log(PASSWORD_REQUIREMENTS);
    const password = await passwordQuestion('New password (hidden): ');
    const invalidPassword = passwordError(password);
    if (invalidPassword) throw new Error(invalidPassword);
    if (password !== await passwordQuestion('Confirm password (hidden): ')) throw new Error('Passwords do not match.');

    dns.setServers(['8.8.8.8','8.8.4.4']);
    await mongoose.connect(process.env.MONGODB_URI);
    await User.init();
    await User.create({username,fullname,email,role:'Admin',status:'Active',passwordHash:await bcrypt.hash(password,12)});
    console.log('Administrator created successfully. Sign in with this account, then create staff accounts in Users Management.');
    console.log('Use server authentication for these shared accounts. Password recovery email delivery requires SMTP configuration.');
  } finally {
    rl.close();output.end();
    await mongoose.disconnect();
  }
}

if (require.main === module) main().catch(error => {
  console.error('Setup failed:',error.code === 11000 ? duplicateAccountMessage(error) : error.name?.startsWith('Mongo') ? 'Could not create the account in the database. Check the database connection and try again.' : error.message);
  process.exitCode = 1;
});
