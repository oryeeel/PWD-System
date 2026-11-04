import {userDisplayName} from '../utils/userDisplayName'
import {activityDescription} from '../utils/activityDescription'
import React, {useEffect,useState} from 'react'
import {RefreshCw,Search,ChevronLeft,ChevronRight,ChevronsLeft,ChevronsRight} from 'lucide-react'
import {apiFetch} from '../utils/apiFetch'
import {loadUsers} from '../utils/storage'
import '../activity-logs.css'

export default function ActivityLogs() {
  const [data,setData] = useState({logs:[],total:0,page:1,pages:1})
  const [search,setSearch] = useState('')
  const [filters,setFilters] = useState({search:'',staff:'',from:'',to:''})
  const staffUsers = loadUsers().filter(user => user.role === 'Staff')
  const [page,setPage] = useState(1)
  const [pageSize,setPageSize] = useState(50)
  const [jumpPage,setJumpPage] = useState('')
  const [version,setVersion] = useState(0)
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')
  const [loaded,setLoaded] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true);setError('')
    const params = new URLSearchParams({...filters,page:String(page),pageSize:String(pageSize)})
    apiFetch(`http://localhost:8081/api/activity-logs?${params}`,{signal:controller.signal})
      .then(async response => {
        if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('Restart the backend to enable activity logs.')
        const result = await response.json()
        if (!response.ok) throw new Error(result.message || 'Could not load activity logs.')
        if (!controller.signal.aborted) {setData(result);setLoaded(true)}
      }).catch(err => {if (!controller.signal.aborted) setError(err.message)})
      .finally(() => {if (!controller.signal.aborted) setLoading(false)})
    return () => controller.abort()
  },[filters,page,pageSize,version])

  useEffect(() => {
    const refresh = () => {if (!document.hidden) setVersion(value => value+1)}
    const timer = window.setInterval(refresh,5000)
    window.addEventListener('focus',refresh)
    return () => {window.clearInterval(timer);window.removeEventListener('focus',refresh)}
  },[])

  function filter(field,value) {setFilters(previous => ({...previous,[field]:value}));setPage(1)}
  return <div className="activity-logs-page">
    <div className="page-title"><div><h1>Staff Activity Logs</h1><p>Review what staff did and when each action occurred.</p></div><button type="button" className="secondary" disabled={loading} onClick={() => setVersion(value => value+1)}><RefreshCw size={16}/> Refresh</button></div>
    <section className="panel">
      <form className="activity-filters" onSubmit={event => {event.preventDefault();filter('search',search)}}>
        <label>Staff<select value={filters.staff} onChange={event => filter('staff',event.target.value)}><option value="">All staff</option>{staffUsers.map(user => <option key={user.id} value={user.username}>{userDisplayName(user)} ({user.username})</option>)}</select></label>
        <label>Search staff, activity or record ID<div><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search activity logs..."/><button className="primary" type="submit"><Search size={16}/> Search</button></div></label>
        <label>From<input type="date" value={filters.from} max={filters.to || undefined} onChange={event => filter('from',event.target.value)}/></label>
        <label>To<input type="date" value={filters.to} min={filters.from || undefined} onChange={event => filter('to',event.target.value)}/></label>
        <button type="button" className="secondary" onClick={() => {setSearch('');setFilters({search:'',staff:'',from:'',to:''});setPage(1)}}>Clear Filters</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {loading && <p role="status">{loaded ? 'Refreshing activity logs...' : 'Loading activity logs...'}</p>}
      {loaded && <>
        <div className="records-table-scroll"><table className="activity-table"><thead><tr><th>Date & Time</th><th>Staff</th><th>Activity</th></tr></thead><tbody>{data.logs.map(log => <tr key={log._id}><td>{new Date(log.createdAt).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'})}</td><td><strong>{userDisplayName(log)}</strong><small>{log.username}</small></td><td>{activityDescription(log)}</td></tr>)}</tbody></table></div>
        {!data.logs.length && <p className="empty">{filters.search || filters.staff || filters.from || filters.to ? 'No activity matches these filters.' : 'No staff activity logged yet. New staff actions will appear here.'}</p>}
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
