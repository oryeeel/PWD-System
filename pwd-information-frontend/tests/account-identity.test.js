import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {normalizeEmail,normalizeUsername} from '../src/utils/accountIdentity.js'

const require = createRequire(import.meta.url)
const {normalizeEmail:serverEmail} = require('../../backend/accountEmail.js')
const {normalizeUsername:serverUsername} = require('../../backend/accountUsername.js')

test('email usernames normalize case and outer spaces without changing Gmail aliases',() => {
  assert.equal(normalizeUsername(' PWD.Registry.Admin@GMAIL.com '),'pwd.registry.admin@gmail.com')
  assert.equal(normalizeUsername(' First.Last+office@Gmail.com '),'first.last+office@gmail.com')
  assert.notEqual(normalizeUsername('first.last@gmail.com'),normalizeUsername('firstlast@gmail.com'))
})

test('legacy usernames preserve exact case and accept only their original character and length rules',() => {
  for (const value of ['Admin','staff_1','office.registrar-2','a'.repeat(50)]) assert.equal(normalizeUsername(value),value)
  for (const value of [' Admin ','ab','a'.repeat(51),'Staff Office','admin!','']) assert.equal(normalizeUsername(value),null)
})

test('frontend email and username validation match the server for valid and malformed identities',() => {
  const values = [
    undefined,null,1,{},'', 'admin','Admin',' staff1 ','A.B_2-3',
    'PWD.Registry.Admin@GMAIL.com',' A+office@example.gov.ph ',"o'connor@example.org",'a/b@example.org',
    'first.last+office@gmail.com','.first@example.com','first.@example.com','first..last@example.com',
    'a@@example.com','a@example','a@-example.com','a@example-.com','a@example..com','a@exa_mple.com',
    'a@example.com\n','a\t@example.com','a\u007f@example.com','á@example.com',
    `${'a'.repeat(64)}@example.com`,`${'a'.repeat(65)}@example.com`,
    `a@${'b'.repeat(63)}.com`,`a@${'b'.repeat(64)}.com`,
    `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`,
    `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(62)}`,
  ]
  for (const value of values) {
    assert.equal(normalizeEmail(value),serverEmail(value),`Email parity for ${String(value)}`)
    assert.equal(normalizeUsername(value),serverUsername(value),`Username parity for ${String(value)}`)
  }
})
