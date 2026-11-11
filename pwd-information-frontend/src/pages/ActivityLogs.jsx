import {userDisplayName} from '../utils/userDisplayName'
import {activityDescription} from '../utils/activityDescription'
import React, {useEffect,useRef,useState} from 'react'
import {ChevronLeft,ChevronRight,ChevronsLeft,ChevronsRight} from 'lucide-react'
import {apiFetch,serverAuthEnabled} from '../utils/apiFetch'
import {loadUsers} from '../utils/storage'
import {oneMonthLater} from '../utils/oneMonthLater'
import '../activity-logs.css'

const activityOptions = ['Signed in','Signed out','Added record','Viewed record','Updated record','Archived record','Restored record','Updated profile photo','Updated document photo','Viewed ID card','Submitted SMS']

export default function ActivityLogs() {
  const [data,setData] = useState({logs:[],total:0,page:1,pages:1})
  const [filters,setFilters] = useState({staff:'',activity:'',from:'',to:''})
  const [staffUsers,setStaffUsers] = useState(() => loadUsers().filter(user => user.role === 'Staff'))
  useEffect(() => {
    if (!serverAuthEnabled) return
    const controller = new AbortController()
    apiFetch('/api/users',{signal:controller.signal}).then(async response => {
      if (!response.ok) throw new Error('Could not load staff filters.')
      const users=await response.json()
      if (!controller.signal.aborted) setStaffUsers(users.filter(user => user.role === 'Staff'))
    }).catch(err => {if (!controller.signal.aborted) setError(err.message)})
    return () => controller.abort()
  },[])
  const [page,setPage] = useState(1)
  const [pageSize,setPageSize] = useState(50)
  const [jumpPage,setJumpPage] = useState('')
  const [version,setVersion] = useState(0)
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')
  const [loaded,setLoaded] = useState(false)
  const lastLoadedQuery = useRef('')
  const fetching = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({...filters,page:String(page),pageSize:String(pageSize)})
    // Older running backends support text search but ignore the activity parameter.
    if (filters.activity) params.set('search',filters.activity)
    const query = params.toString()
    fetching.current = true
    setLoading(lastLoadedQuery.current !== query);setError('')
    apiFetch(`http://localhost:8081/api/activity-logs?${params}`,{signal:controller.signal})
      .then(async response => {
        if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('Restart the backend to enable activity logs.')
        const result = await response.json()
        if (!response.ok) throw new Error(result.message || 'Could not load activity logs.')
        if (!controller.signal.aborted) {lastLoadedQuery.current=query;setData(result);setLoaded(true)}
      }).catch(err => {if (!controller.signal.aborted) setError(err.message)})
      .finally(() => {if (!controller.signal.aborted) {fetching.current=false;setLoading(false)}})
    return () => {controller.abort();fetching.current=false}
  },[filters,page,pageSize,version])

  useEffect(() => {
    const refresh = () => {if (!document.hidden && !fetching.current) setVersion(value => value+1)}
    const timer = window.setInterval(refresh,5000)
    window.addEventListener('focus',refresh)
    return () => {window.clearInterval(timer);window.removeEventListener('focus',refresh)}
  },[])

  function filter(field,value) {
    setFilters(previous => ({...previous,[field]:value,...(field === 'from' ? {to:oneMonthLater(value)} : {})}))
    setPage(1)
  }
  return <div className="activity-logs-page">
    <div className="page-title"><div><h1>Staff Activity Logs</h1><p>Review what staff did and when each action occurred.</p></div></div>
    <section className="panel">
      <div className="activity-filters">
        <label>Staff<select value={filters.staff} onChange={event => filter('staff',event.target.value)}><option value="">All staff</option>{staffUsers.map(user => <option key={user.id} value={user.username}>{userDisplayName(user)} ({user.username})</option>)}</select></label>
        <label>Activity<select value={filters.activity} onChange={event => filter('activity',event.target.value)}><option value="">All activities</option>{activityOptions.map(action => <option key={action} value={action}>{action === 'Submitted SMS' ? 'Sent SMS' : action}</option>)}</select></label>
        <label>From<input type="date" value={filters.from} onChange={event => filter('from',event.target.value)}/></label>
        <label>To<input type="date" value={filters.to} min={filters.from || undefined} onChange={event => filter('to',event.target.value)}/></label>
        <button type="button" className="secondary clear-filters-button" data-active={Boolean(filters.staff || filters.activity)} disabled={!Object.values(filters).some(Boolean)} onClick={() => {setFilters({staff:'',activity:'',from:'',to:''});setPage(1)}}>Clear Filters</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {loading && !loaded && <p role="status">Loading activity logs...</p>}
      {loaded && <>
        <div className="records-table-scroll"><table className="activity-table"><thead><tr><th>Date & Time</th><th>Staff</th><th>Activity</th></tr></thead><tbody>{data.logs.map(log => <tr key={log._id}><td>{new Date(log.createdAt).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'})}</td><td><strong>{userDisplayName(log)}</strong><small>{log.username}</small></td><td>{activityDescription(log)}</td></tr>)}</tbody></table></div>
        {!data.logs.length && <p className="empty">{filters.staff || filters.activity || filters.from || filters.to ? 'No activity matches these filters.' : 'No staff activity logged yet. New staff actions will appear here.'}</p>}
        <div className="activity-pagination">
          <span aria-live="polite">{data.total ? `${((data.page-1)*(data.pageSize || 20)+1).toLocaleString()}–${Math.min(data.page*(data.pageSize || 20),data.total).toLocaleString()} of ${data.total.toLocaleString()} activities` : '0 activities'}</span>
          <label className="activity-page-size">Rows per page <select aria-label="Rows per page" value={pageSize} disabled={loading} onChange={event => {setPageSize(Number(event.target.value));setPage(1);setJumpPage('')}}>{[20,50,100].map(size => <option key={size} value={size}>{size}</option>)}</select></label>
          <nav aria-label="Activity log pages">
            <button type="button" className="secondary" aria-label="First page" title="First page" disabled={loading || data.page <= 1} onClick={() => setPage(1)}><ChevronsLeft size={16}/></button>
            <button type="button" className="secondary" aria-label="Previous page" title="Previous page" disabled={loading || data.page <= 1} onClick={() => setPage(data.page-1)}><ChevronLeft size={16}/></button>
            <span>Page {data.page} of {data.pages}</span>
            <button type="button" className="secondary" aria-label="Next page" title="Next page" disabled={loading || data.page >= data.pages} onClick={() => setPage(data.page+1)}><ChevronRight size={16}/></button>
            <button type="button" className="secondary" aria-label="Last page" title="Last page" disabled={loading || data.page >= data.pages} onClick={() => setPage(data.pages)}><ChevronsRight size={16}/></button>
          </nav>
          <form className="activity-page-jump" onSubmit={event => {event.preventDefault();const target=Number(jumpPage);if (Number.isInteger(target) && target >= 1 && target <= data.pages) {setPage(target);setJumpPage('')}}}>
            <label>Go to page <input aria-label="Go to page" type="number" min="1" max={data.pages} step="1" required value={jumpPage} onChange={event => setJumpPage(event.target.value)}/></label>
            <button type="submit" className="secondary" disabled={loading || !jumpPage}>Go</button>
          </form>
        </div>
      </>}
    </section>
  </div>
}
