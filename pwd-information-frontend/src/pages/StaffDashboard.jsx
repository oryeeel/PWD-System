import {getSession} from '../utils/storage'
import {userDisplayName} from '../utils/userDisplayName'
import React, {useMemo,useRef} from 'react'
import {Link} from 'react-router-dom'
import {Accessibility, ArrowRight, CalendarDays, Download, FileBarChart2, FilePlus2, Mail, Megaphone, Search, UserRound, Users} from 'lucide-react'
import {useRecords} from '../utils/recordsApi'
import {countAgeGroups} from '../utils/ageGroups'
import '../staff-dashboard.css'

const ageColors = ['#2563eb','#f97316','#16a34a','#9333ea','#e11d48','#64748b']
const monthKey = date => String(date || '').slice(0,7)
const asDate = date => new Date(date).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})

function downloadPwdList(records) {
  const escape = value => `"${String(value ?? '').replaceAll('"','""')}"`
  const rows = [
    ['ID','Full Name','Age','Gender','Disability Type','Barangay','Status'],
    ...records.map(record => [record.pwdId,[record.firstName,record.middleName,record.lastName].filter(Boolean).join(' '),record.age,record.gender,record.disabilityType,record.barangay,record.status]),
  ]
  const blob = new Blob(['\uFEFF',rows.map(row => row.map(escape).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'})
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `PWD_List_${new Date().toISOString().slice(0,10)}.csv`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url),30000)
}

function StaffStat({icon,label,value,detail}) {
  return <div className="staff-stat"><span className="staff-stat-icon">{icon}</span><div><small>{label}</small><strong>{value.toLocaleString()}</strong><span>{detail}</span></div></div>
}

export default function StaffDashboard() {
  const downloadDialog = useRef(null)
  const {records,error} = useRecords()
  const thisMonth = new Date().toISOString().slice(0,7)
  const male = records.filter(record => record.gender === 'Male').length
  const female = records.filter(record => record.gender === 'Female').length
  const active = records.filter(record => record.status === 'Active').length
  const addedThisMonth = records.filter(record => monthKey(record.createdAt) === thisMonth).length
  const updatedThisMonth = records.filter(record => monthKey(record.lastEditedAt) === thisMonth).length
  const percent = count => records.length ? `${(count / records.length * 100).toFixed(1)}% of total` : '0% of total'
  const ageData = useMemo(() => countAgeGroups(records),[records])
  const ageMax = Math.max(1,...ageData.map(item => item.count))
  const ageStep = 50
  const ageChartMax = Math.ceil(ageMax / ageStep) * ageStep
  const ageTicks = Array.from({length:ageChartMax / ageStep + 1},(_,index) => ageChartMax - index * ageStep)
  const updates = useMemo(() => records.flatMap(record => [
    record.createdAt && {record,kind:'New record added',at:record.createdAt},
    record.lastEditedAt && {record,kind:'Record updated',at:record.lastEditedAt},
  ].filter(Boolean)).sort((a,b) => new Date(b.at) - new Date(a.at)).slice(0,4),[records])
  let reportsThisMonth = 0
  try {reportsThisMonth = JSON.parse(localStorage.getItem('pwd_report_exports_v1') || '[]').filter(date => monthKey(date) === thisMonth).length} catch { /* Storage may be unavailable. */ }

  return <div className="staff-dashboard">
    <header className="staff-welcome"><h1>Good {new Date().getHours() < 12 ? 'Morning' : new Date().getHours() < 18 ? 'Afternoon' : 'Evening'}, {userDisplayName(getSession())}!</h1><p>Here&apos;s your system overview.</p></header>
    {error && <div className="empty">Could not load records: {error}</div>}
    <div className="staff-stats">
      <StaffStat icon={<Users size={30}/>} label="TOTAL PWDS" value={records.length} detail="All records"/>
      <StaffStat icon={<Accessibility size={30}/>} label="ACTIVE CASES" value={active} detail={percent(active)}/>
      <StaffStat icon={<UserRound size={29}/>} label="MALE" value={male} detail={percent(male)}/>
      <StaffStat icon={<UserRound size={29}/>} label="FEMALE" value={female} detail={percent(female)}/>
      <StaffStat icon={<FilePlus2 size={29}/>} label="RECORDS ADDED THIS MONTH" value={addedThisMonth} detail={new Date().toLocaleDateString(undefined,{month:'long',year:'numeric'})}/>
    </div>
    <div className="staff-grid">
      <section className="staff-panel staff-updates"><h2>Posted Updates</h2><p>Latest record activity.</p><div className="staff-update-grid">{updates.map(({record,kind,at}) => <Link to={`/records/${record.pwdId}`} className="staff-update" key={`${record.pwdId}-${kind}`}><span><FilePlus2 size={21}/></span><div><strong>{kind}</strong><small>{record.firstName} {record.lastName} · {record.pwdId}</small><p>{asDate(at)}</p><em>{kind.includes('updated') ? 'Update' : 'Record'}</em></div></Link>)}{!updates.length && <div className="staff-empty">No record updates yet.</div>}</div></section>
      <section className="staff-panel staff-announcements"><h2>Announcements</h2><div className="staff-announcement"><CalendarDays size={24}/><div><strong>Monthly Report Reminder</strong><p>Review this month&apos;s PWD records and generate the report when ready.</p><small>{new Date().toLocaleDateString(undefined,{month:'long',year:'numeric'})}</small></div></div><div className="staff-announcement"><Megaphone size={24}/><div><strong>Record Updates</strong><p>{updatedThisMonth} record{updatedThisMonth === 1 ? '' : 's'} updated this month.</p></div></div><Link className="staff-announcement-link" to="/reports">View Reports <ArrowRight size={16}/></Link></section>
      <section className="staff-panel staff-quick"><h2>Quick Actions</h2><Link to="/add"><FilePlus2 size={19}/> Add New PWD Record <ArrowRight size={16}/></Link><Link to="/records"><Search size={19}/> Search / View Records <ArrowRight size={16}/></Link><Link to="/reports"><FileBarChart2 size={19}/> Generate Reports <ArrowRight size={16}/></Link><button type="button" onClick={() => downloadDialog.current.showModal()} disabled={!records.length}><Download size={19}/> Download PWD List <ArrowRight size={16}/></button><Link to="/messages"><Mail size={19}/> Send a Message <ArrowRight size={16}/></Link></section>
      <section className="staff-panel staff-age"><h2>PWDs by Age Group</h2>
        <div className="staff-age-figure" style={{'--age-groups':ageData.length}} role="img" aria-label={`Number of PWDs by age group in years: ${ageData.map(item => `${item.label}: ${item.count}`).join(', ')}`}>
          <div className="staff-age-y-title">Number of PWDs</div>
          <div className="staff-age-chart">
            <div className="staff-age-axis">{ageTicks.map(tick => <span key={tick} style={{top:`${(ageChartMax - tick) / ageChartMax * 100}%`}}>{tick}</span>)}</div>
            <div className="staff-age-plot">
              <div className="staff-age-lines">{ageTicks.map(tick => <i key={tick} style={{top:`${(ageChartMax - tick) / ageChartMax * 100}%`}}/>)}</div>
              <div className="staff-age-bars">{ageData.map((item,index) => <div className="staff-age-column" key={item.label} style={{'--age-height':`${item.count / ageChartMax * 100}%`}}><strong>{item.count}</strong><div className="staff-age-bar" style={{background:ageColors[index]}}/></div>)}</div>
            </div>
            <div className="staff-age-labels">{ageData.map((item,index) => <span key={item.label}><i style={{background:ageColors[index]}}/>{item.label}</span>)}</div>
          </div>
          <div className="staff-age-x-title">Age Group (years)</div>
        </div>
        <p className="staff-age-total">Total: {records.length.toLocaleString()} PWD records · All staff and admin records, excluding archived records</p>
      </section>
      <section className="staff-panel staff-summary"><h2>Summary (This Month)</h2><div><FilePlus2 size={18}/><span>Records Added</span><strong>{addedThisMonth}</strong></div><div><FilePlus2 size={18}/><span>Records Updated</span><strong>{updatedThisMonth}</strong></div><div><FileBarChart2 size={18}/><span>Reports Generated</span><strong>{reportsThisMonth}</strong></div></section>
    </div>
    <dialog ref={downloadDialog} className="staff-download-dialog" aria-labelledby="download-list-title" aria-describedby="download-list-question"><h2 id="download-list-title">Download PWD List</h2><p id="download-list-question">Are you sure you want to download the PWD list?</p><div><button type="button" className="secondary" autoFocus onClick={() => downloadDialog.current.close()}>No</button><button type="button" className="primary" disabled={!records.length} onClick={() => {downloadDialog.current.close();downloadPwdList(records)}}>Yes</button></div></dialog>
  </div>
}
