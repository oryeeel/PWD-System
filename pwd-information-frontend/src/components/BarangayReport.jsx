import React, {useMemo,useRef,useState} from 'react'
import {useRecords} from '../utils/recordsApi'
import {columns,recordCells,groupBarangayRecords,exportBarangayExcel,exportBarangayPdf} from '../utils/barangayReport'
import {downloadReport} from '../utils/reportExport'
import {oneMonthAfter} from '../utils/reportDates'

export default function BarangayReport() {
  const {records,error}=useRecords()
  const [allDates,setAllDates]=useState(true)
  const [start,setStart]=useState('')
  const [end,setEnd]=useState(new Date().toISOString().slice(0,10))
  const [disability,setDisability]=useState('')
  const [notice,setNotice]=useState('')
  const [pendingFormat,setPendingFormat]=useState(null)
  const exportDialog=useRef(null)
  const valid=allDates || Boolean(start && end && start<=end)
  const types=useMemo(() => [...new Set(records.map(record => record.disabilityType).filter(Boolean))].sort(),[records])
  const selected=useMemo(() => valid ? records.filter(record => {
    const date=String(record.createdAt || '').slice(0,10)
    return (allDates || (date>=start && date<=end)) && (!disability || record.disabilityType===disability)
  }) : [],[records,valid,allDates,start,end,disability])
  const groups=useMemo(() => groupBarangayRecords(selected),[selected])
  const filterLabel=`${allDates ? 'All dates' : `${start} to ${end}`} | Disability Type: ${disability || 'All'}`
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
    <h2>Complete PWD Records List</h2>
    <p>Consolidated PWD records grouped by barangay and sorted by last name.</p>
    {error && <div className="error">Could not load records: {error}</div>}
    <div className="reports-category-filters">
      <label className="barangay-all-dates"><input type="checkbox" checked={allDates} onChange={event => setAllDates(event.target.checked)}/> All dates</label>
      {!allDates && <><label>Date added from<input type="date" value={start} onChange={event => {setStart(event.target.value);setEnd(oneMonthAfter(event.target.value))}}/></label><label>Date added to<input type="date" value={end} min={start} onChange={event => setEnd(event.target.value)}/></label></>}
      <label>Disability Type<select value={disability} onChange={event => setDisability(event.target.value)}><option value="">All disability types</option>{types.map(type => <option key={type}>{type}</option>)}</select></label>
    </div>
    {!valid && <div className="error">Choose a start date on or before the end date.</div>}
    <div className="barangay-report-actions"><strong>Total Records: {selected.length}</strong><button className="primary" disabled={!valid || Boolean(error)} onClick={() => requestExport('xlsx')}>Export Excel</button><button className="secondary" disabled={!valid || Boolean(error)} onClick={() => requestExport('pdf')}>Export PDF</button></div>
    <dialog ref={exportDialog} className="report-export-dialog" aria-labelledby="barangay-export-title" aria-describedby="barangay-export-question" onClose={() => setPendingFormat(null)}>
      <h2 id="barangay-export-title">Export {pendingFormat==='xlsx' ? 'Excel' : 'PDF'}</h2>
      <p id="barangay-export-question">Are you sure you want to download the Complete PWD Records List as {pendingFormat==='xlsx' ? 'Excel' : 'PDF'}?</p>
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
