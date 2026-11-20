const {test} = require('node:test')
const assert = require('node:assert/strict')

test('record address display appends a separately stored barangay',async()=>{
  const {displayRecordAddress} = await import('../src/utils/recordAddress.js')
  assert.equal(displayRecordAddress({address:'Zone 2, Purok 4',barangay:'SAN MARTIN'}),'Zone 2, Purok 4, SAN MARTIN')
})

test('record address display does not duplicate a barangay already in the address',async()=>{
  const {displayRecordAddress} = await import('../src/utils/recordAddress.js')
  assert.equal(displayRecordAddress({address:'Zone 2, Brgy. SAN MARTIN, Villanueva, Misamis Oriental',barangay:'SAN MARTIN'}),'Zone 2, Brgy. SAN MARTIN, Villanueva, Misamis Oriental')
})

test('record address display inserts barangay before municipality when missing',async()=>{
  const {displayRecordAddress} = await import('../src/utils/recordAddress.js')
  assert.equal(displayRecordAddress({address:'Zone 2, Villanueva, Misamis Oriental',barangay:'SAN MARTIN'}),'Zone 2, SAN MARTIN, Villanueva, Misamis Oriental')
})
