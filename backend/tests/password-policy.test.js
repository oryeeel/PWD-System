const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {passwordError,PASSWORD_REQUIREMENTS} = require('../passwordPolicy');

const accepted = [
  'Test-password1!',
  'Abcdefghij1!',
  'Aa1!'+'x'.repeat(4),
  'Aa1!'+'x'.repeat(16),
  'Aa1!'+'\u00e9'.repeat(16),
  'Aa1'+'\u{1f600}'.repeat(5),
  'Aa1'+'\u{1f600}'.repeat(17),
  'Abcdefghij1\u20ac',
  'Abcdefghij1\u2014',
  'Aa1!'+'x'.repeat(7)+' ',
];
const rejected = [
  undefined,null,123,true,{},[],
  '', 'Aa1!', 'Aa1!'+'x'.repeat(3),
  'Aa1!'+'x'.repeat(17),
  'Aa'+'\u{1f600}'.repeat(17)+'\u20ac',
  'Aa1'+'\u{1f600}'.repeat(4),
  'Aa1'+'\u{1f600}'.repeat(18),
  'lowercase1-only!', 'UPPERCASE1-ONLY!',
  'OnlyLettersLong1', 'Mixed123456789', 'Mixed-case-password!', 'Abcdefghij1 ',
  'Abcdefghij1\u00e9', 'Abcdefghij1\u4e2d',
  '\u00c9'+'a'.repeat(11)+'1!', 'A'+'\u00e9'.repeat(11)+'1!',
];

test('password policy accepts uppercase, lowercase, numbers and punctuation or symbols within both limits',()=>{
  assert.equal(typeof PASSWORD_REQUIREMENTS,'string');assert.ok(PASSWORD_REQUIREMENTS.length > 0);
  for (const value of accepted) assert.equal(passwordError(value),'',JSON.stringify(value));
});

test('password policy rejects missing character classes, nonstrings and out-of-range passwords',()=>{
  for (const value of rejected) {
    const error = passwordError(value);
    assert.equal(typeof error,'string',JSON.stringify(value));
    assert.ok(error.length > 0,JSON.stringify(value));
  }
});

test('password limits count Unicode code points and enforce the bcrypt UTF-8 byte ceiling',()=>{
  const sevenCharacters = 'Aa1'+'\u{1f600}'.repeat(4);
  const eightCharacters = 'Aa1'+'\u{1f600}'.repeat(5);
  const twentyCharacters = 'Aa1'+'\u{1f600}'.repeat(17);
  const twentyOneCharacters = 'Aa1'+'\u{1f600}'.repeat(18);
  assert.equal(Array.from(sevenCharacters).length,7);assert.ok(sevenCharacters.length > 8);
  assert.equal(Array.from(eightCharacters).length,8);
  assert.equal(Array.from(twentyCharacters).length,20);assert.ok(twentyCharacters.length > 20);
  assert.equal(Array.from(twentyOneCharacters).length,21);
  assert.equal(passwordError(sevenCharacters),'Use a password of 8-20 characters.');
  assert.equal(passwordError(eightCharacters),'');assert.equal(passwordError(twentyCharacters),'');
  assert.equal(passwordError(twentyOneCharacters),'Use a password of 8-20 characters.');
  // Compliant 20-character passwords reach at most 71 bytes. These equal-length
  // samples omit the number so the separate byte guard remains exercised.
  const seventyTwoBytes = 'Aa'+'\u{1f600}'.repeat(17)+'\u00e9';
  const seventyThreeBytes = 'Aa'+'\u{1f600}'.repeat(17)+'\u20ac';
  assert.equal(Buffer.byteLength(seventyTwoBytes,'utf8'),72);
  assert.equal(Buffer.byteLength(seventyThreeBytes,'utf8'),73);
  assert.equal(Array.from(seventyTwoBytes).length,20);
  assert.equal(Array.from(seventyThreeBytes).length,20);
  assert.match(passwordError(seventyTwoBytes),/number/);
  assert.match(passwordError(seventyThreeBytes),/72 UTF-8 bytes/);
});

test('the browser export applies exactly the same password policy as Node',()=>{
  const context = vm.createContext({TextEncoder});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../passwordPolicy.js'),'utf8'),context);
  const browserPolicy = context.PasswordPolicy;
  assert.ok(browserPolicy,'The policy exposes its browser API.');
  assert.equal(browserPolicy.PASSWORD_REQUIREMENTS,PASSWORD_REQUIREMENTS);
  for (const value of [...accepted,...rejected]) assert.equal(browserPolicy.passwordError(value),passwordError(value));
});
