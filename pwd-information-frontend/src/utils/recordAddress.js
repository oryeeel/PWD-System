import {normalizeBarangay} from './barangays.js'

export function buildRecordAddress(zone,barangay) {
  return [zone,barangay,'Villanueva, Misamis Oriental'].map(value => (value || '').trim()).filter(Boolean).join(', ')
}

export function displayRecordAddress(record) {
  const address = typeof record?.address === 'string' ? record.address.trim() : ''
  const barangay = normalizeBarangay(record?.barangay || '')
  if (!address) return barangay
  if (!barangay) return address

  const parts = address.split(',').map(part => part.trim()).filter(Boolean)
  const hasBarangay = parts.some(part => {
    const name = part.replace(/^(?:barangay|brgy\.?)\s*/i,'').trim()
    return normalizeBarangay(name).toUpperCase() === barangay.toUpperCase()
  })
  if (hasBarangay) return address

  const locality = parts.slice(-2).map(part => part.toLowerCase())
  if (locality[0] === 'villanueva' && locality[1] === 'misamis oriental') {
    return [...parts.slice(0,-2),barangay,...parts.slice(-2)].join(', ')
  }
  return [...parts,barangay].join(', ')
}

export function recordZone(record) {
  if (record.zone) return record.zone
  const address = (record.address || '').trim()
  const suffix = buildRecordAddress('',record.barangay)
  if (address.toLowerCase() === suffix.toLowerCase()) return ''
  if (address.toLowerCase().endsWith(`, ${suffix.toLowerCase()}`)) return address.slice(0,-suffix.length-2).trim()
  return address
}
