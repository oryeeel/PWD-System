import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {passwordError,PASSWORD_REQUIREMENTS} from '../src/utils/passwordPolicy.js'

const require = createRequire(import.meta.url)
const serverPolicy = require('../../backend/passwordPolicy.js')

test('new passwords require uppercase, lowercase, a number, and a punctuation or symbol character',() => {
  for (const value of ['ValidPassword1!','Aa1!' + 'x'.repeat(4),'Aa1!' + 'x'.repeat(16),'ValidPassword1©','ValidPassword1—','ValidPassword1😀']) {
    assert.equal(passwordError(value),'',`Accept ${value}`)
  }
  for (const value of ['validpassword1!','VALIDPASSWORD1!','ValidPassword123','ValidPassword1   ','ValidPassword1é']) {
    assert.ok(passwordError(value),`Reject ${value}`)
  }
})

test('a password with the other required character types still needs a number from 0 to 9',() => {
  assert.equal(passwordError('ValidPassword!'),'Include at least one number (0-9).')
  assert.equal(passwordError('ValidPassword١!'),'Include at least one number (0-9).')
  for (const digit of '0123456789') assert.equal(passwordError(`ValidPassword${digit}!`),'')
})

test('password lengths accept 8-20 Unicode code points and preserve spaces',() => {
  const lengthError = 'Use a password of 8-20 characters.'
  assert.equal(passwordError('Aa1!' + 'x'.repeat(3)),lengthError)
  assert.equal(passwordError('Aa1!' + 'x'.repeat(4)),'')
  assert.equal(passwordError('Aa1!' + 'x'.repeat(16)),'')
  assert.equal(passwordError('Aa1!' + 'x'.repeat(17)),lengthError)
  assert.equal(passwordError('Aa1' + '😀'.repeat(4)),lengthError, 'Seven code points do not meet the minimum')
  assert.equal(passwordError('Aa1' + '😀'.repeat(5)),'', 'Eight code points meet the minimum')
  assert.equal(passwordError('Aa1' + '😀'.repeat(17)),'', 'Twenty code points fit despite using 37 UTF-16 units')
  assert.equal(passwordError('Aa1' + '😀'.repeat(18)),lengthError, 'Twenty-one code points exceed the maximum')
  assert.equal(passwordError(' Aa1!xy '),'', 'Passwords are not trimmed')
})

test('bcrypt byte limit remains enforced within the character limit',() => {
  assert.equal(passwordError('😀'.repeat(18)),'Include at least one uppercase letter (A-Z).', '72 UTF-8 bytes pass the byte check')
  assert.equal(passwordError('A' + '😀'.repeat(18)),'Use a password of at most 72 UTF-8 bytes. Some characters use more than one byte.', '73 UTF-8 bytes fail even at 19 code points')
})

test('frontend requirements and validation match the backend policy',() => {
  assert.equal(PASSWORD_REQUIREMENTS,serverPolicy.PASSWORD_REQUIREMENTS)
  for (const value of [undefined,null,0,{},'', 'shortA1!', 'ValidPassword1!', 'ValidPassword!', 'ValidPassword١!', 'alllowercase1!', 'ALLUPPERCASE1!', '123456789012!',
    'Upperlower123', 'Upperlower1   ', 'Upperlower1éé', 'Upperlower1©©', 'Upperlower1😀😀',
    'Aa1!' + 'x'.repeat(3), 'Aa1!' + 'x'.repeat(4), 'Aa1!' + 'x'.repeat(16), 'Aa1!' + 'x'.repeat(17),
    'Aa1' + '😀'.repeat(4), 'Aa1' + '😀'.repeat(5), 'Aa1' + '😀'.repeat(17), 'Aa1' + '😀'.repeat(18),
    '😀'.repeat(18), 'A' + '😀'.repeat(18), ' Aa1!xy ']) {
    assert.equal(passwordError(value),serverPolicy.passwordError(value),`Policy parity for ${String(value)}`)
  }
})
