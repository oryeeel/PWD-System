import {oneMonthAfter} from '../utils/reportDates'
import {barangays} from '../utils/barangays'
import React, {useEffect, useMemo, useState} from 'react'
import {FileBarChart2, X, FileSpreadsheet, FileText} from 'lucide-react'
import {useRecords} from '../utils/recordsApi'
import {buildExcelReport, buildPdfReport, downloadReport} from '../utils/reportExport'
import BarangayReport from '../components/BarangayReport'
import {countAgeGroups} from '../utils/ageGroups'

const colors = ['#16a34a','#2563eb','#f59e0b','#9333ea','#06b6d4','#ef4444','#ec4899','#f97316','#4f46e5','#84cc16','#0d9488','#c026d3']
const groupNames = {disabilityType:'Disability Type',barangay:'Barangay',gender:'Gender',age:'Age Group',status:'Status'}
const ageOptions = countAgeGroups([]).map(({label}) => label)
function groupRecords(records,group) {
  if (group === 'age') return countAgeGroups(records).map(({label,count}) => [label,count])
  return Object.entries(records.reduce((counts,record) => {
    const key = record[group] || 'Unspecified'
    counts[key] = (counts[key] || 0) + 1
    return counts
  },{})).sort((a,b) => b[1] - a[1])
}
function dateLabel(value) {return new Date(`${value}T00:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}
function matchesCategory(record, disabilityType, barangay, age, gender) {
  return (!disabilityType || record.disabilityType === disabilityType) && (!barangay || record.barangay === barangay) &&
    (!gender || record.gender === gender) && (!age || countAgeGroups([record]).some(item => item.label === age && item.count > 0))
}

export default function Reports() {
  const [mode,setMode] = useState('summary')
  return <><label className="report-type-selector">Report Type<select value={mode} onChange={event => setMode(event.target.value)}><option value="summary">Disability Type Summary</option><option value="barangays">Complete PWD Records List</option></select></label>{mode === 'barangays' ? <BarangayReport/> : <SummaryReports group="disabilityType"/>}</>
}

function SummaryReports({group}) {
  const {records,error} = useRecords()
  const today = new Date().toISOString().slice(0,10)
  const defaultStart = new Date(Date.now() - 60 * 86400000).toISOString().slice(0,10)
  const [allDates,setAllDates] = useState(true)
  const [reportAllDates,setReportAllDates] = useState(true)
  const [start,setStart] = useState(defaultStart)
  const [end,setEnd] = useState(today)
  const [disabilityType,setDisabilityType] = useState('')
  const [barangay,setBarangay] = useState('')
  const [age,setAge] = useState('')
  const [gender,setGender] = useState('')
  const [reportAge,setReportAge] = useState('')
  const [reportGender,setReportGender] = useState('')
  const [reportOpen,setReportOpen] = useState(false)
  const [reportGroup,setReportGroup] = useState(group)
  const [reportStart,setReportStart] = useState(defaultStart)
  const [reportEnd,setReportEnd] = useState(today)
  const [reportDisabilityType,setReportDisabilityType] = useState('')
  const [reportBarangay,setReportBarangay] = useState('')
  const [exportError,setExportError] = useState('')
  const [exportSuccess,setExportSuccess] = useState('')
  const validRange = allDates || Boolean(start && end && start <= end)
  const disabilityTypes = useMemo(() => [...new Set(records.map(record => record.disabilityType).filter(Boolean))].sort(),[records])

  useEffect(() => {
    if (!reportOpen) return
    const close = event => {if (event.key === 'Escape') setReportOpen(false)}
    window.addEventListener('keydown',close)
    return () => window.removeEventListener('keydown',close)
  },[reportOpen])

  function openReport() {
    setReportGroup(group)
    setReportAge(age);setReportGender(gender)
    setReportAllDates(allDates);setReportStart(start);setReportEnd(end);setReportDisabilityType(disabilityType);setReportBarangay(barangay);setExportError('');setExportSuccess('');setReportOpen(true)
  }

  function exportReport(format) {
    if (!reportRangeValid || !['xlsx','pdf'].includes(format)) return
    try {
      setExportError('');setExportSuccess('')
      const details = {allDates:reportAllDates,group:reportGroup,start:reportStart,end:reportEnd,disabilityType:reportDisabilityType,barangay:reportBarangay,age:reportAge,gender:reportGender,data:reportData,total:reportRecords.length}
      const blob = format === 'xlsx' ? buildExcelReport(details) : buildPdfReport(details)
      if (!blob.size) throw new Error('The generated file is empty.')
      downloadReport(blob,`PWD_Report_${reportGroup}_${reportAllDates ? 'All_Dates' : `${reportStart}_to_${reportEnd}`}.${format}`)
      try {
        const history = JSON.parse(localStorage.getItem('pwd_report_exports_v1') || '[]')
        localStorage.setItem('pwd_report_exports_v1',JSON.stringify([...history,new Date().toISOString()].slice(-500)))
      } catch { /* A blocked browser store should not prevent the download. */ }
      setExportSuccess(`${format === 'xlsx' ? 'Excel' : 'PDF'} report downloaded.`)
    } catch (error) {setExportError(`Export failed: ${error.message}`)}
  }

  const reportRangeValid = reportAllDates || Boolean(reportStart && reportEnd && reportStart <= reportEnd &&
    (new Date(`${reportEnd}T00:00:00Z`) - new Date(`${reportStart}T00:00:00Z`)) <= 366 * 86400000)
  const reportRecords = useMemo(() => reportRangeValid ? records.filter(record => {
    const date = String(record.createdAt || '').slice(0,10)
    return (reportAllDates || (date >= reportStart && date <= reportEnd)) && matchesCategory(record,reportDisabilityType,reportBarangay,reportAge,reportGender)
  }) : [],[records,reportStart,reportEnd,reportAllDates,reportRangeValid,reportDisabilityType,reportBarangay,reportAge,reportGender])
  const reportData = useMemo(() => groupRecords(reportRecords,reportGroup),[reportRecords,reportGroup])

  const selected = useMemo(() => validRange ? records.filter(record => {
    const date = String(record.createdAt || '').slice(0,10)
    return (allDates || (date >= start && date <= end)) && matchesCategory(record,disabilityType,barangay,age,gender)
  }) : [],[records,start,end,allDates,validRange,disabilityType,barangay,age,gender])
  const data = useMemo(() => groupRecords(selected,group),[selected,group])
  const max = Math.max(1,...data.map(([,count]) => count))
  const tickStep = 25
  const chartMax = Math.max(tickStep,Math.ceil(max / tickStep) * tickStep)
  const ticks = Array.from({length:Math.round(chartMax / tickStep) + 1},(_,index) => chartMax - index * tickStep)

  return <div className="reports-page">
    <h1>Reports</h1>
    <section className="reports-panel">
      {error && <div className="empty">Could not load records: {error}</div>}
      <div className="reports-controls">
        <div><label style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}><input type="checkbox" checked={allDates} onChange={event => setAllDates(event.target.checked)}/> All dates</label><strong>Date Range</strong><div className="reports-dates"><input disabled={allDates} aria-label="Start date" type="date" value={start} onChange={event => {setStart(event.target.value);setEnd(oneMonthAfter(event.target.value))}}/><span>➜</span><input disabled={allDates} aria-label="End date" type="date" value={end} min={start || undefined} onChange={event => setEnd(event.target.value)}/></div></div>
      </div>
      <div className="reports-category-filters"><label>Age Group<select value={age} onChange={event => setAge(event.target.value)}><option value="">All age groups</option>{ageOptions.map(label => <option key={label} value={label}>{label}</option>)}<option value="Unspecified">Unspecified</option></select></label><label>Barangay<select value={barangay} onChange={event => setBarangay(event.target.value)}><option value="">All barangays</option>{barangays.map(name => <option key={name} value={name}>{name}</option>)}</select></label><label>Disability Type<select value={disabilityType} onChange={event => setDisabilityType(event.target.value)}><option value="">All disability types</option>{disabilityTypes.map(type => <option key={type} value={type}>{type}</option>)}</select></label><label>Gender<select value={gender} onChange={event => setGender(event.target.value)}><option value="">All genders</option><option>Male</option><option>Female</option></select></label><button type="button" className="clear-filters-button" data-active={Boolean(disabilityType || barangay || age || gender)} onClick={() => {setDisabilityType('');setBarangay('');setAge('');setGender('')}} disabled={!disabilityType && !barangay && !age && !gender}>Clear Filters</button></div>
      {!validRange && <div className="error">Choose a start date on or before the end date.</div>}
      <h2>PWD by {groupNames[group]} <small>({allDates ? 'All dates' : validRange ? `${dateLabel(start)} - ${dateLabel(end)}` : 'Select dates'})</small></h2>
      <div className="chart-with-axes reports-labeled-chart">
        <div className="chart-y-title">Number of PWD records</div>
        <div className="column-chart-scroll">
          <div className="column-chart" role="img" aria-label={`PWD by ${groupNames[group]}: ${data.map(([label,count]) => `${label}, ${count}`).join('; ')}`}>
            <div className="chart-axis" aria-hidden="true">{ticks.map(tick => <span key={tick} style={{top:`${(chartMax - tick) / chartMax * 100}%`}}>{tick}</span>)}</div>
            <div className="chart-content">
              <div className="chart-plot">
                {ticks.map(tick => <div className="chart-gridline chart-gridline-major" key={tick} style={{top:`${(chartMax - tick) / chartMax * 100}%`}}/>)}
                <div className="chart-columns" style={{gridTemplateColumns:`repeat(${Math.max(1,data.length)},minmax(0,1fr))`}}>{data.map(([label,count],index) => <div className="chart-column" key={label} style={{'--bar-height':`${count / chartMax * 100}%`,'--bar-color':colors[index % colors.length]}}><strong className="chart-bar-value">{count}</strong><div className="chart-bar" style={{height:'var(--bar-height)'}} title={`${label}: ${count} records`}/></div>)}</div>
              </div>
              <div className="chart-labels" style={{gridTemplateColumns:`repeat(${Math.max(1,data.length)},minmax(0,1fr))`}}>{data.map(([label]) => <div key={label} title={label}>{label}</div>)}</div>
              <div className="chart-x-title">{groupNames[group]} categories</div>
            </div>
          </div>
        </div>
      </div>
      {!data.length && <p className="reports-empty">No records found for the selected dates and filters.</p>}
      <div className="reports-bottom"><p><strong>Total Records:</strong> {selected.length}</p><button onClick={openReport}><FileBarChart2 size={18}/> Generate Report</button></div>
    </section>
    {reportOpen && <div className="report-modal-backdrop" onMouseDown={() => setReportOpen(false)}>
      <section className="report-modal report-preview-modal" role="dialog" aria-modal="true" aria-label="Report Preview" onMouseDown={event => event.stopPropagation()}>
        <button className="report-modal-close" aria-label="Close report popup" onClick={() => setReportOpen(false)}><X size={20}/></button>
        <div className="report-modal-preview">
          <h2>Report Preview</h2>
          <strong>PWD by {groupNames[reportGroup]}</strong>
          <span>{reportAllDates ? 'All dates' : reportRangeValid ? `${dateLabel(reportStart)} - ${dateLabel(reportEnd)}` : 'Choose a valid date range within one year on the Reports page.'}</span>
          <p className="report-preview-filters">Disability Type: {reportDisabilityType || 'All'} &middot; Barangay: {reportBarangay || 'All'}</p>
          <p className="report-preview-filters">Age Group: {reportAge || 'All'} &middot; Gender: {reportGender || 'All'}</p>
          <div className="report-preview-list">{reportData.map(([label,count]) => <div key={label}><span>{label}</span><b>{count}</b></div>)}{!reportData.length && <p>No records match the selected dates and filters.</p>}</div>
          <div className="report-preview-total"><strong>Total Records</strong><b>{reportRecords.length.toLocaleString()}</b></div>
          <div className="report-direct-exports">
            <button type="button" disabled={!reportRangeValid || Boolean(error)} onClick={() => exportReport('xlsx')}><FileSpreadsheet size={22}/> Export Excel</button>
            <button type="button" disabled={!reportRangeValid || Boolean(error)} onClick={() => exportReport('pdf')}><FileText size={22}/> Export PDF</button>
          </div>
          {exportError && <div className="error" role="alert">{exportError}</div>}
          {exportSuccess && <p className="report-export-success" role="status">{exportSuccess}</p>}
        </div>
      </section>
    </div>}
  </div>
}


