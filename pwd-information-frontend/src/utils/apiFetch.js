import {getSession,clearSession} from './storage'
export const serverAuthEnabled = import.meta.env.VITE_SERVER_AUTH === 'true'

export function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers)
  const user = getSession()
  if (user && !serverAuthEnabled) headers.set('X-PWD-Actor', encodeURIComponent(JSON.stringify({id:user.id,username:user.username,fullname:user.fullname,role:user.role})))
  const apiBase = (import.meta.env.VITE_API_URL || '').replace(/\/$/,'')
  const requestUrl = url.replace(/^http:\/\/localhost:8081(?=\/api\/)/,apiBase)
  return fetch(requestUrl, {...options,headers,credentials:'include'}).then(response => {
    if (serverAuthEnabled && response.status === 401 && !requestUrl.includes('/api/auth/')) {
      clearSession()
      window.location.assign('/login')
    }
    return response
  })
}

export function recordStaffEvent(action, recordId = '') {
  if (getSession()?.role !== 'Staff') return Promise.resolve()
  return apiFetch('http://localhost:8081/api/activity-events', {
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,recordId}),
  }).catch(() => {})
}
