import React, {useMemo,useRef,useState} from 'react'
import {useRecords} from '../utils/recordsApi'
import {columns,recordCells,groupBarangayRecords,exportBarangayExcel,exportBarangayPdf} from '../utils/barangayReport'
import {downloadReport} from '../utils/reportExport'
import {oneMonthAfter} from '../utils/reportDates'
import {barangays} from '../utils/barangays'
import {countAgeGroups} from '../utils/ageGroups'

const ageOptions=countAgeGroups([]).map(({label})=>label)

export default function BarangayReport({reportTypeControl,dateRange}) {
  const {records,error}=useRecords()
  const {allDates,setAllDates,start,setStart,end,setEnd}=dateRange
  const [disability,setDisability]=useState('')
  const [age,setAge]=useState('')
  const [barangay,setBarangay]=useState('')
  const [gender,setGender]=useState('')
  const [notice,setNotice]=useState('')
  const [pendingFormat,setPendingFormat]=useState(null)
  const exportDialog=useRef(null)
  const valid=allDates || Boolean(start && end && start<=end)
  const types=useMemo(() => [...new Set(records.map(record => record.disabilityType).filter(Boolean))].sort(),[records])
  const selected=useMemo(() => valid ? records.filter(record => {
    const date=String(record.createdAt || '').slice(0,10)
    return (allDates || (date>=start && date<=end)) && (!disability || record.disabilityType===disability) &&
      (!barangay || record.barangay===barangay) && (!gender || record.gender===gender) &&
      (!age || countAgeGroups([record]).some(item=>item.label===age && item.count>0))
  }) : [],[records,valid,allDates,start,end,disability,age,barangay,gender])
  const groups=useMemo(() => groupBarangayRecords(selected).filter(group=>!barangay || group.name===barangay),[selected,barangay])
  const filterLabel=`${allDates ? 'All dates' : `${start} to ${end}`} | Age Group: ${age || 'All'} | Barangay: ${barangay || 'All'} | Disability Type: ${disability || 'All'} | Gender: ${gender || 'All'}`
  function download(format) {
    if (!valid || error || !['xlsx','pdf'].includes(format)) return
    try {
      const blob=format==='xlsx' ? exportBarangayExcel(groups,filterLabel) : exportBarangayPdf(groups,filterLabel)
      downloadReport(blob,`PWD_All_Barangays_${allDates ? 'All_Dates' : `${start}_to_${end}`}.${format}`)
      try {
        const history=JSON.parse(localStorage.getItem('pwd_report_exports_v1') || '[]')
        localStorage.setItem('pwd_report_exports_v1',JSON.stringify([...history,new Date().toISOString()].slice(-500)))
      } catch { /* Downloads also work when browser storage is unavailable. */ }
      setNotice(`${format==='xlsx' ? 'Excel' : 'PDF'} report downloaded.`)
    } catch (err) {setNotice(`Export failed: ${err.message}`)}
  }
  function requestExport(format) {
    setNotice('')
    setPendingFormat(format)
    exportDialog.current.showModal()
  }
  return <div className="reports-page"><h1>Reports</h1><section className="reports-panel barangay-report">
    <div className="registry-report-intro"><h2>Detailed PWD Registry</h2>
    <p>Consolidated PWD records grouped by barangay and sorted by last name.</p></div>
    {error && <div className="error">Could not load records: {error}</div>}
    <div className="reports-controls reports-top-controls">
      {reportTypeControl}
      <div>
      <label style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}><input type="checkbox" checked={allDates} onChange={event => setAllDates(event.target.checked)}/> All dates</label>
      <strong>Date Range</strong>
      <div className="reports-dates"><input disabled={allDates} aria-label="Start date" type="date" value={start} onChange={event=>{setStart(event.target.value);setEnd(oneMonthAfter(event.target.value))}}/><span>→</span><input disabled={allDates} aria-label="End date" type="date" value={end} min={start || undefined} onChange={event=>setEnd(event.target.value)}/></div>
      </div>
    </div>
    <div className="reports-category-filters">
      <label>Age Group<select value={age} onChange={event=>setAge(event.target.value)}><option value="">All age groups</option>{ageOptions.map(label=><option key={label} value={label}>{label}</option>)}<option value="Unspecified">Unspecified</option></select></label>
      <label>Barangay<select value={barangay} onChange={event=>setBarangay(event.target.value)}><option value="">All barangays</option>{barangays.map(name=><option key={name} value={name}>{name}</option>)}</select></label>
      <label>Disability Type<select value={disability} onChange={event => setDisability(event.target.value)}><option value="">All disability types</option>{types.map(type => <option key={type}>{type}</option>)}</select></label>
      <label>Gender<select value={gender} onChange={event=>setGender(event.target.value)}><option value="">All genders</option><option>Male</option><option>Female</option></select></label>
      <button type="button" className="clear-filters-button" data-active={Boolean(age || barangay || disability || gender)} disabled={!age && !barangay && !disability && !gender} onClick={()=>{setAge('');setBarangay('');setDisability('');setGender('')}}>Clear Filters</button>
    </div>
    {!valid && <div className="error">Choose a start date on or before the end date.</div>}
    <div className="barangay-report-actions"><strong>Total Records: {selected.length}</strong><button className="primary" disabled={!valid || Boolean(error)} onClick={() => requestExport('xlsx')}>Export Excel</button><button className="secondary" disabled={!valid || Boolean(error)} onClick={() => requestExport('pdf')}>Export PDF</button></div>
    <dialog ref={exportDialog} className="report-export-dialog" aria-labelledby="barangay-export-title" aria-describedby="barangay-export-question" onClose={() => setPendingFormat(null)}>
      <h2 id="barangay-export-title">Export {pendingFormat==='xlsx' ? 'Excel' : 'PDF'}</h2>
      <p id="barangay-export-question">Are you sure you want to download the Detailed PWD Registry as {pendingFormat==='xlsx' ? 'Excel' : 'PDF'}?</p>
      <div>
        <button type="button" className="secondary" autoFocus onClick={() => exportDialog.current.close()}>No</button>
        <button type="button" className="primary" disabled={!valid || Boolean(error) || !pendingFormat} onClick={() => {exportDialog.current.close();download(pendingFormat)}}>Yes, Download</button>
      </div>
    </dialog>
    {notice && <p role="status">{notice}</p>}
    <div className="barangay-report-heading"><strong>PWD Registry and Information Management System</strong><span>MSWDO | Villanueva, Misamis Oriental</span><span>{filterLabel}</span></div>
    {groups.map(group => <section key={group.name} className="barangay-report-section"><h3>{group.name==='Unassigned' ? 'Unassigned — barangay needs updating' : `Barangay ${group.name}`} <small>({group.records.length} records)</small></h3><div className="barangay-report-scroll"><table><thead><tr>{columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead><tbody>{group.records.map((record,index) => <tr key={record.pwdId}>{recordCells(record,index).map((cell,i) => <td key={i}>{cell || '—'}</td>)}</tr>)}{!group.records.length && <tr><td colSpan={columns.length}>No records match the selected filters.</td></tr>}</tbody></table></div></section>)}
  </section></div>
}
