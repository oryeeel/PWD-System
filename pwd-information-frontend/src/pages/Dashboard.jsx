import React, {useEffect,useMemo,useState} from 'react'
import {Users, UserRound, Check, ArrowRight} from 'lucide-react'
import {Link} from 'react-router-dom'
import {useRecords} from '../utils/recordsApi'
import {apiFetch} from '../utils/apiFetch'
import {getSession} from '../utils/storage'


const colors = ['#2563eb','#f97316','#16a34a','#9333ea','#06b6d4','#e11d48','#eab308','#475569']

function makeGradient(groups, total) {
  if (!total) return '#e9f1ec'
  let start = 0
  return `conic-gradient(${groups.map(([,count],index) => {
    const end = start + count / total * 100
    const segment = `${colors[index % colors.length]} ${start}% ${end}%`
    start = end
    return segment
  }).join(',')})`
}

function recentRecords(records) {
  return records.map(record => {
    const events = [
      {label: 'Newly added', at: record.createdAt},
      {label: 'Updated', at: record.lastEditedAt},
      {label: 'Viewed', at: record.lastViewedAt},
    ].filter(event => event.at && !Number.isNaN(Date.parse(event.at)))
    events.sort((a,b) => new Date(b.at) - new Date(a.at))
    return {record, event: events[0]}
  }).filter(item => item.event)
    .sort((a,b) => new Date(b.event.at) - new Date(a.event.at))
    .slice(0,8)
}

function weeklyPoints(records, predicate) {
  const now = Date.now()
  const week = 7 * 24 * 60 * 60 * 1000
  const counts = Array.from({length:8}, (_,index) => records.filter(record => {
    const date = Date.parse(record.createdAt)
    return predicate(record) && date >= now - (8 - index) * week && date < now - (7 - index) * week
  }).length)
  const highest = Math.max(1,...counts)
  return counts.map((count,index) => `${index * 26},${30 - count / highest * 25}`).join(' ')
}

function Stat({icon,label,value,detail,color,points}) {
  return <div className="overview-stat" style={{'--stat-color': color}}>
    <div className="overview-stat-main"><span className="overview-stat-icon">{icon}</span><div><small>{label}</small><strong>{value.toLocaleString()}</strong><span className="overview-stat-detail">{detail}</span></div></div>
    <svg className="stat-sparkline" viewBox="0 0 182 35" preserveAspectRatio="none" aria-hidden="true"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /></svg>
    <div className="stat-foot">Records added over the last 8 weeks</div>
  </div>
}

export default function Dashboard() {
  const {records,error} = useRecords()
  const [staffActivity,setStaffActivity] = useState([])
  const [activityError,setActivityError] = useState('')
  const isAdmin = getSession()?.role === 'Admin'
  useEffect(() => {
    if (!isAdmin) return
    const controller = new AbortController()
    let pending = false
    async function refreshActivity() {
      if (pending || document.hidden) return
      pending = true
      try {
        const [activity,archived] = await Promise.all([
          apiFetch('http://localhost:8081/api/activity-logs?pageSize=100',{signal:controller.signal}),
          apiFetch('http://localhost:8081/api/recycle-bin',{signal:controller.signal}),
        ])
        if (!activity.ok || !archived.ok) throw new Error('Could not load staff activity.')
        const [result,archiveRecords] = await Promise.all([activity.json(),archived.json()])
        if (!controller.signal.aborted) {
          setStaffActivity({logs:result.logs,archived:archiveRecords})
          setActivityError('')
        }
      } catch (err) {
        if (!controller.signal.aborted) setActivityError('Could not load staff activity. Showing recent record updates.')
      } finally {pending = false}
    }
    refreshActivity()
    const timer = window.setInterval(refreshActivity,5000)
    return () => {controller.abort();window.clearInterval(timer)}
  },[isAdmin])
  const male = records.filter(r => r.gender === 'Male').length
  const female = records.filter(r => r.gender === 'Female').length
  const active = records.filter(r => r.status === 'Active').length
  const pct = value => records.length ? `${Math.round(value / records.length * 100)}% of records` : '0% of records'
  const byType = useMemo(() => Object.entries(records.reduce((counts,record) => {
    const type = record.disabilityType || 'Unspecified'
    counts[type] = (counts[type] || 0) + 1
    return counts
  }, {})).sort((a,b) => b[1] - a[1]), [records])
  const recent = useMemo(() => {
    const fallback = recentRecords(records).map(item => ({...item,key:`record-${item.record.pwdId}`}))
    if (!isAdmin || !staffActivity.logs) return fallback
    const lookup = new Map([...staffActivity.archived,...records].map(record => [record.pwdId,record]))
    const logged = staffActivity.logs.filter(log => log.recordId).map(log => ({
      key:log._id,
      record:lookup.get(log.recordId) || {pwdId:log.recordId,firstName:log.recordName || 'Record unavailable'},
      event:{label:log.action,at:log.createdAt},
    }))
    // Prefer logged staff actions over the same record's timestamp summary.
    const loggedIds = new Set(logged.map(item => item.record.pwdId))
    return [...logged,...fallback.filter(item => !loggedIds.has(item.record.pwdId))]
      .sort((a,b) => new Date(b.event.at) - new Date(a.event.at)).slice(0,8)
  },[records,staffActivity,isAdmin])
  const lines = useMemo(() => ({
    all: weeklyPoints(records, () => true),
    male: weeklyPoints(records, r => r.gender === 'Male'),
    female: weeklyPoints(records, r => r.gender === 'Female'),
    active: weeklyPoints(records, r => r.status === 'Active'),
  }), [records])

  return <div className="dashboard-page">
    <div className="page-title"><div><h1>Dashboard Overview</h1></div></div>
    {error && <div className="empty">Could not load records: {error}</div>}
    <div className="overview-stats">
      <Stat icon={<Users size={27}/>} label="TOTAL PWDS" value={records.length} detail="All records" color="#17954c" points={lines.all}/>
      <Stat icon={<UserRound size={27}/>} label="MALE" value={male} detail={pct(male)} color="#2f72d6" points={lines.male}/>
      <Stat icon={<UserRound size={27}/>} label="FEMALE" value={female} detail={pct(female)} color="#9c4bd3" points={lines.female}/>
      <Stat icon={<Check size={29}/>} label="ACTIVE CASES" value={active} detail={pct(active)} color="#ef8c20" points={lines.active}/>
    </div>

    <div className="overview-panels">
      <section className="panel distribution-panel">
        <div className="panel-head"><h3>PWDs by Disability Type</h3></div>
        <div className="distribution-body">
          <div className="overview-donut" style={{background:makeGradient(byType,records.length)}}><div><strong>{records.length}</strong><small>Total PWDs</small></div></div>
          <div className="overview-breakdown">
            <div className="breakdown-header"><span>Disability Type</span><span>Count</span><span>Percent</span></div>
            {byType.map(([type,count],index) => <div className="breakdown-row" key={type}><span><i style={{background:colors[index % colors.length]}}/>{type}</span><b>{count}</b><b>{Math.round(count / records.length * 100)}%</b></div>)}
            {!byType.length && <p className="empty">No records yet.</p>}
          </div>
        </div>
        {byType.length > 0 && <p className="distribution-note">Most common disability type: <strong>{byType[0][0]}</strong> ({Math.round(byType[0][1] / records.length * 100)}%).</p>}
      </section>

      <section className="panel dashboard-records-panel">
        <div className="panel-head"><h3>Recent Activity</h3><Link to="/records">View all records <ArrowRight size={14}/></Link></div>
        {activityError && <p role="status">{activityError}</p>}
        <div className="recent-table-scroll"><table className="recent-table"><thead><tr><th>ID</th><th>Full Name</th><th>Age</th><th>Gender</th><th>Disability Type</th><th>Barangay</th><th>Activity</th></tr></thead><tbody>
          {recent.map(({record,event,key}) => <tr key={key}><td><Link to={record.deletedAt ? '/records?view=archived' : `/records/${record.pwdId}`}>{record.pwdId}</Link></td><td>{record.firstName} {record.lastName}</td><td>{record.age}</td><td>{record.gender}</td><td>{record.disabilityType}</td><td>{record.barangay}</td><td><span className="recent-activity">{event.label}</span></td></tr>)}
        </tbody></table>{!recent.length && <div className="empty">No recent activity.</div>}</div>
      </section>
    </div>
  </div>
}
