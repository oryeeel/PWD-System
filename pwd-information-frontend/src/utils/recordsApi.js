import {apiFetch} from './apiFetch'
import React from 'react'
import {createLiveStore} from './liveStore'

const API = 'http://localhost:8081/api/records'

async function request(url, options) {
  const response = await apiFetch(url, options)
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    if (response.status === 404 && (url.includes('/recycle') || url.includes('/restore'))) throw new Error('Restart the backend server to enable archiving. No record was changed.')
    throw new Error(response.ok ? 'Server returned an unexpected response.' : `Server returned ${response.status} instead of record data.`)
  }
  const data = await response.json()
  if (!response.ok) throw new Error(data.message || 'Record request failed')
  return data
}

export const getRecords = () => request(API)
export const createRecord = record => request(API, {
  method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(record),
})
// Keep the existing storage endpoints so previously recycled records remain restorable.
export const archiveRecord = pwdId => request(`${API}/${encodeURIComponent(pwdId)}/recycle`, {method: 'POST'})
export const getArchivedRecords = () => request('http://localhost:8081/api/recycle-bin')
export const restoreRecord = pwdId => request(`http://localhost:8081/api/recycle-bin/${encodeURIComponent(pwdId)}/restore`, {method:'POST'})
export async function updateRecordPhoto(pwdId, photo) {
  const recordUrl = `${API}/${encodeURIComponent(pwdId)}`
  const response = await apiFetch(`${recordUrl}/photo`, {
    method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({photo}),
  })
  // A backend started before the photo route was added responds with an HTML 404.
  // Its existing full-record update route can still save the photo.
  if (response.status === 404 && !(response.headers.get('content-type') || '').includes('application/json')) {
    const latest = await request(recordUrl)
    const updated = await request(recordUrl, {
      method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...latest, photo}),
    })
    if (updated.photo !== photo) throw new Error('The running backend did not store the photo. Restart the backend server and try again.')
    return updated
  }
  if (!(response.headers.get('content-type') || '').includes('application/json')) {
    throw new Error(`Server returned ${response.status} instead of record data.`)
  }
  const data = await response.json()
  if (!response.ok) throw new Error(data.message || 'Failed to save photo.')
  if (data.photo !== photo) throw new Error('The running backend did not store the photo. Restart the backend server and try again.')
  return data
}
export const trackRecordView = pwdId => request(`${API}/${encodeURIComponent(pwdId)}/view`, {method: 'POST'})

const recordsStore = createLiveStore(getRecords)
const archiveStore = createLiveStore(getArchivedRecords)

export function useRecords() {
  return {...React.useSyncExternalStore(recordsStore.subscribe,recordsStore.getSnapshot,recordsStore.getSnapshot),refresh:recordsStore.refresh}
}

export function useArchivedRecords() {
  return {...React.useSyncExternalStore(archiveStore.subscribe,archiveStore.getSnapshot,archiveStore.getSnapshot),refresh:archiveStore.refresh}
}

export function notifyRecordsUpdated() {
  window.dispatchEvent(new Event('pwd-records-updated'))
  try {localStorage.setItem('pwd-records-revision',`${Date.now()}-${Math.random()}`)} catch { /* Polling keeps other sessions current when storage is unavailable. */ }
}
