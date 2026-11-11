import {userDisplayName} from '../utils/userDisplayName'
import {apiFetch} from '../utils/apiFetch'
import {getSession} from '../utils/storage'
import RecordDocumentPhotos from '../components/RecordDocumentPhotos'
import {barangays} from '../utils/barangays'
import React, {useEffect, useState} from 'react'
import {Link, useParams} from 'react-router-dom'
import {ArrowLeft, Download, Printer, Pencil, FileText, MapPin, ExternalLink, CreditCard, UserRound, X, ZoomIn, ZoomOut} from 'lucide-react'
import {jsPDF} from 'jspdf'
import {notifyRecordsUpdated, trackRecordView} from '../utils/recordsApi'
import {disabilityTypes, specificDisabilities} from '../utils/disabilities'

const displayDate = value => {
  if (!value) return 'N/A'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'})
}

function Field({label,value}) {
  return <div className="record-field"><span>{label}</span><span>:</span><strong>{value || 'N/A'}</strong></div>
}

function PrintSheet({record,fullName}) {
  return <div className="record-print-preview"><div className="print-sheet-title"><strong>PWD Registry and Information Management System</strong><small>MSWDO | Villanueva, Misamis Oriental</small><b>PWD RECORD</b></div><Field label="ID" value={record.pwdId}/><Field label="Full Name" value={fullName}/><Field label="Birthdate" value={displayDate(record.birthdate)}/><Field label="Age" value={record.age ?? 'N/A'}/><Field label="Gender" value={record.gender}/><Field label="Address" value={record.address || record.barangay}/><Field label="Disability Type" value={record.disabilityType}/>{record.disabilityType === 'Multiple Disabilities' && <Field label="Specific Disabilities" value={(record.disabilities || []).join(', ')}/>}<Field label="Contact Number" value={record.contact}/><Field label="Status" value={record.status}/><Field label="Date Added" value={displayDate(record.createdAt)}/><Field label="Added by" value={record.addedBy && userDisplayName({username:record.addedBy})}/></div>
}

function downloadPdf(record, fullName, paperSize, includePhoto) {
  const pdf = new jsPDF({format:paperSize})
  pdf.setFont('helvetica','bold'); pdf.setFontSize(13)
  pdf.text('PWD Registry and Information Management System',20,22)
  pdf.setFontSize(11); pdf.setFont('helvetica','normal')
  pdf.text('MSWDO | Villanueva, Misamis Oriental',20,29)
  pdf.setDrawColor(7,124,49); pdf.line(20,34,190,34)
  pdf.setFont('helvetica','bold'); pdf.setFontSize(15)
  pdf.text(`PWD Record - ${record.pwdId}`,20,46)
  if (includePhoto) {
    pdf.setDrawColor(130,135,132); pdf.circle(178,51,9)
    pdf.setFontSize(6); pdf.text('PHOTO',172,52)
  }
  const rows = [
    ['Full Name',fullName], ['Birthdate',displayDate(record.birthdate)],
    ['Age',String(record.age ?? 'N/A')], ['Gender',record.gender],
    ['Address',record.address || record.barangay], ['Disability Type',record.disabilityType],
    ...(record.disabilityType === 'Multiple Disabilities' ? [['Specific Disabilities',(record.disabilities || []).join(', ')]] : []),
    ['Contact Number',record.contact], ['Status',record.status],
    ['Date Added',displayDate(record.createdAt)], ['Added by',record.addedBy && userDisplayName({username:record.addedBy})],
  ]
  let y = 60
  pdf.setFontSize(11)
  rows.forEach(([label,value]) => {
    const lines = pdf.splitTextToSize(String(value || 'N/A'),112)
    pdf.setFont('helvetica','bold'); pdf.text(`${label}:`,20,y)
    pdf.setFont('helvetica','normal'); pdf.text(lines,73,y)
    y += Math.max(1,lines.length) * 7 + 4
  })
  pdf.save(`${record.pwdId}.pdf`)
}

export default function RecordDetails() {
  const {id} = useParams()
  const isStaff = getSession()?.role === 'Staff'
  const [record,setRecord] = useState(null)
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')
  const [modal,setModal] = useState(null)
  const [form,setForm] = useState(null)
  const [saving,setSaving] = useState(false)
  const [actionError,setActionError] = useState('')
  const [paperSize,setPaperSize] = useState('a4')
  const [includePhoto,setIncludePhoto] = useState(true)
  const [orientation,setOrientation] = useState('portrait')
  const [copies,setCopies] = useState(1)
  const [zoom,setZoom] = useState(1)
  const [section,setSection] = useState('personal')

  function printRecord() {
    const pageStyle = document.createElement('style')
    pageStyle.textContent = `@page { size: ${paperSize} ${orientation}; margin: 14mm; }`
    document.head.appendChild(pageStyle)
    const cleanup = () => { pageStyle.remove(); window.removeEventListener('afterprint',cleanup) }
    window.addEventListener('afterprint',cleanup)
    window.print()
  }

  useEffect(() => {
    if (!modal) return
    const onKey = event => { if (event.key === 'Escape') setModal(null) }
    window.addEventListener('keydown',onKey)
    return () => window.removeEventListener('keydown',onKey)
  },[modal])

  function openModal(kind) {
    setActionError('')
    if (kind === 'edit') setForm({
      firstName: record.firstName || '', middleName: record.middleName || '', lastName: record.lastName || '',
      birthdate: record.birthdate || '', age: record.age ?? '', gender: record.gender || '',
      barangay: record.barangay || '', address: record.address || '', disabilityType: record.disabilityType || '', disabilities: record.disabilities || [],
      contact: record.contact || '', status: record.status || 'Active', civilStatus: record.civilStatus || '',
      bloodType: record.bloodType || '', emergencyContactName: record.emergencyContactName || '',
      emergencyContactPhone: record.emergencyContactPhone || '', photo: record.photo || '',
    })
    setModal(kind)
  }

  async function saveEdit(event) {
    event.preventDefault()
    if (saving) return
    if (!barangays.includes(form.barangay)) { setActionError('Select a valid barangay.'); return }
    if (form.disabilityType === 'Multiple Disabilities' && form.disabilities.length < 2) {
      setActionError('Select at least two specific disabilities.'); return
    }
    try {
      setSaving(true); setActionError('')
      const response = await apiFetch(`http://localhost:8081/api/records/${encodeURIComponent(id)}`,{
        method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...form,age:Number(form.age) || 0}),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Failed to update record')
      setRecord(data)
      notifyRecordsUpdated()
      setModal(null)
    } catch (err) { setActionError(err.message) }
    finally { setSaving(false) }
  }

  function choosePhoto(event) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/') || file.size > 400000) {
      setActionError('Choose an image smaller than 400 KB.');event.target.value = '';return
    }
    const reader = new FileReader()
    reader.onload = () => setForm(previous => ({...previous,photo:String(reader.result)}))
    reader.onerror = () => setActionError('Could not read the photo.')
    reader.readAsDataURL(file)
  }

  useEffect(() => {
    let cancelled = false
    async function loadRecord() {
      try {
        setLoading(true); setError('')
        const response = await apiFetch(`http://localhost:8081/api/records/${encodeURIComponent(id)}`)
        const data = await response.json()
        if (!response.ok) throw new Error(data.message || 'PWD record not found')
        if (cancelled) return
        setRecord(data)
        trackRecordView(id).then(notifyRecordsUpdated).catch(err => console.error('Failed to track record view:',err))
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load PWD record')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadRecord()
    return () => {cancelled = true}
  }, [id])

  if (loading) return <div className="empty">Loading PWD record...</div>
  if (error || !record) return <div className="empty">{error || 'Record not found.'}</div>

  const fullName = [record.firstName,record.middleName,record.lastName].filter(Boolean).join(' ')
  const area = [record.barangay,'Villanueva, Misamis Oriental, Philippines'].filter(Boolean).join(', ')
  return <div className="record-detail-page record-workspace">
    <Link className="record-back" to="/records"><ArrowLeft size={18}/> Back to List</Link>
    <h1>View PWD Record</h1>
    <section className="record-workspace-shell">
      <aside className="record-profile-sidebar">
        <div className="record-portrait">{record.photo ? <img src={record.photo} alt={fullName}/> : <UserRound size={90}/>}</div>
        <strong>{record.pwdId}</strong><span className={record.status === 'Active' ? 'record-status active' : 'record-status'}>{record.status || 'N/A'}</span>
        <nav aria-label="Record sections"><button type="button" aria-pressed={section === 'personal'} onClick={() => setSection('personal')}><UserRound size={18}/> Personal Information</button><button type="button" aria-pressed={section === 'documents'} onClick={() => setSection('documents')}><FileText size={18}/> Documents</button></nav>
        {isStaff && <Link className="secondary" to={`/records/${record.pwdId}/edit`}><Pencil size={16}/> Edit Record</Link>}
        {isStaff && <Link className="secondary" to={`/records/${record.pwdId}/id`}><CreditCard size={16}/> View ID</Link>}
      </aside>
      <div className="record-workspace-content">
        <header className="record-name-heading"><h2>{fullName}</h2><p>PWD ID: {record.pwdId}</p></header>
        <section className="record-personal-section" hidden={section !== 'personal'} aria-label="Personal information"><h3>Personal Information</h3><div className="record-info-grid">
          <Field label="Full Name" value={fullName}/><Field label="Birthdate" value={displayDate(record.birthdate)}/><Field label="Age" value={record.age ?? 'N/A'}/><Field label="Gender" value={record.gender}/><Field label="Address" value={record.address || record.barangay}/><Field label="Disability Type" value={record.disabilityType}/>
          {record.disabilityType === 'Multiple Disabilities' && <Field label="Specific Disabilities" value={(record.disabilities || []).join(', ')}/>}
          <Field label="Contact Number" value={record.contact}/><Field label="Civil Status" value={record.civilStatus}/><Field label="Blood Type" value={record.bloodType}/><Field label="Emergency Contact" value={record.emergencyContactName}/><Field label="Emergency Number" value={record.emergencyContactPhone}/><Field label="Date Added" value={displayDate(record.createdAt)}/><Field label="Added by" value={record.addedBy && userDisplayName({username:record.addedBy})}/>
        </div></section>
        <section className="record-docs-section" hidden={section !== 'documents'} aria-label="Record documents"><h3>Documents</h3><RecordDocumentPhotos key={record.pwdId} record={record} onPhotoUpdated={photo => setRecord(previous => ({...previous,photo}))}/></section>
      </div>
      <aside className="record-location-panel"><h3><MapPin size={17}/> Location</h3><iframe title={`Area map: ${area}`} loading="lazy" referrerPolicy="no-referrer" src={`https://maps.google.com/maps?q=${encodeURIComponent(area)}&z=13&output=embed`}/><h4>Recorded Address</h4><p>{record.address || record.barangay || 'Not provided'}</p><small>Barangay / municipal area only. Exact home location is not recorded.</small><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(area)}`} target="_blank" rel="noreferrer">Open map <ExternalLink size={14}/></a></aside>
    </section>
    {modal && <div className="record-modal-backdrop" onMouseDown={() => setModal(null)}>
      <section className={`record-action-modal ${modal === 'edit' ? 'record-edit-modal' : ''} ${modal === 'print' ? 'record-print-modal' : ''}`} role="dialog" aria-modal="true" aria-label={{download:'Download PWD Record as PDF',print:'Print PWD Record',edit:'Edit Record'}[modal]} onMouseDown={event => event.stopPropagation()}>
        <div className="record-modal-head"><h2>{{download:'Download PWD Record as PDF',print:'Print PWD Record',edit:'Edit Record'}[modal]}</h2><button aria-label="Close popup" onClick={() => setModal(null)}><X size={20}/></button></div>
        {modal === 'download' && <div className="record-modal-content record-download-options"><label>Paper Size<select value={paperSize} onChange={event => setPaperSize(event.target.value)}><option value="a4">A4 (210 × 297 mm)</option><option value="letter">Letter (216 × 279 mm)</option><option value="legal">Legal (216 × 356 mm)</option></select></label><fieldset><legend>Include Photo</legend><label><input type="radio" checked={includePhoto} onChange={() => setIncludePhoto(true)}/> Yes</label><label><input type="radio" checked={!includePhoto} onChange={() => setIncludePhoto(false)}/> No</label></fieldset><small>No photo is stored for this record; “Yes” adds a photo placeholder.</small><div className="record-modal-footer"><button className="secondary" onClick={() => setModal(null)}>Cancel</button><button className="primary" onClick={() => {downloadPdf(record,fullName,paperSize,includePhoto);setModal(null)}}><Download size={17}/> Download PDF</button></div></div>}
        {modal === 'print' && <div className="record-modal-content print-dialog-layout"><div className="print-preview-pane"><span>Print Preview</span><div className="print-preview-paper" style={{'--preview-zoom':zoom}}><PrintSheet record={record} fullName={fullName}/></div><div className="print-preview-controls"><span>1 / 1</span><button title="Zoom out" onClick={() => setZoom(Math.max(.7,zoom-.1))}><ZoomOut size={17}/></button><button title="Zoom in" onClick={() => setZoom(Math.min(1.3,zoom+.1))}><ZoomIn size={17}/></button></div></div><div className="print-options"><label>Printer<div className="printer-note">Choose printer in the system print dialog</div></label><label>Paper Size<select value={paperSize} onChange={event => setPaperSize(event.target.value)}><option value="a4">A4 (210 × 297 mm)</option><option value="letter">Letter (216 × 279 mm)</option><option value="legal">Legal (216 × 356 mm)</option></select></label><fieldset><legend>Orientation</legend><label><input type="radio" checked={orientation === 'portrait'} onChange={() => setOrientation('portrait')}/> Portrait</label><label><input type="radio" checked={orientation === 'landscape'} onChange={() => setOrientation('landscape')}/> Landscape</label></fieldset><label>Copies<input type="number" min="1" max="20" value={copies} onChange={event => setCopies(Math.min(20,Math.max(1,Number(event.target.value) || 1)))} /></label><div className="record-modal-footer"><button className="secondary" onClick={() => setModal(null)}>Cancel</button><button className="primary" onClick={printRecord}><Printer size={17}/> Print</button></div></div><div className="print-copies">{Array.from({length:copies},(_,index) => <PrintSheet key={index} record={record} fullName={fullName}/>)}</div></div>}
        {modal === 'edit' && <form className="record-modal-content" onSubmit={saveEdit}>
          {actionError && <div className="error">{actionError}</div>}
          <div className="record-modal-fields">
            <label>First Name<input required value={form.firstName} onChange={event => setForm({...form,firstName:event.target.value})}/></label>
            <label>Middle Name<input value={form.middleName} onChange={event => setForm({...form,middleName:event.target.value})}/></label>
            <label>Last Name<input required value={form.lastName} onChange={event => setForm({...form,lastName:event.target.value})}/></label>
            <label>Birthdate<input type="date" value={form.birthdate} onChange={event => setForm({...form,birthdate:event.target.value})}/></label>
            <label>Age<input type="number" min="0" value={form.age} onChange={event => setForm({...form,age:event.target.value})}/></label>
            <label>Gender<select value={form.gender} onChange={event => setForm({...form,gender:event.target.value})}><option value="">Select gender</option><option>Male</option><option>Female</option></select></label>
            <label>Barangay<select value={form.barangay} onChange={event => setForm({...form,barangay:event.target.value})} required><option value="">Select barangay</option>{form.barangay && !barangays.includes(form.barangay) && <option value={form.barangay} disabled>{form.barangay} (choose a valid barangay)</option>}{barangays.map(value => <option key={value}>{value}</option>)}</select></label>
            <label>Disability Type<select value={form.disabilityType} onChange={event => setForm({...form,disabilityType:event.target.value,disabilities:event.target.value === 'Multiple Disabilities' ? form.disabilities : []})}><option value="">Select disability type</option>{disabilityTypes.map(type => <option key={type}>{type}</option>)}</select></label>
            {form.disabilityType === 'Multiple Disabilities' && <fieldset className="record-modal-disabilities"><legend>Specific Disabilities (select at least two)</legend>{specificDisabilities.map(type => <label key={type}><input type="checkbox" checked={form.disabilities.includes(type)} onChange={() => setForm(previous => ({...previous,disabilities:previous.disabilities.includes(type) ? previous.disabilities.filter(item => item !== type) : [...previous.disabilities,type]}))}/>{type}</label>)}</fieldset>}
            <label>Contact Number<input value={form.contact} onChange={event => setForm({...form,contact:event.target.value})}/></label>
            <label>Status<select value={form.status} onChange={event => setForm({...form,status:event.target.value})}><option>Active</option><option>Inactive</option></select></label>
            <label>Civil Status<select value={form.civilStatus} onChange={event => setForm({...form,civilStatus:event.target.value})}><option value="">Not provided</option><option>Single</option><option>Married</option><option>Widowed</option><option>Separated</option></select></label>
            <label>Blood Type<select value={form.bloodType} onChange={event => setForm({...form,bloodType:event.target.value})}><option value="">Not provided</option>{['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(type => <option key={type}>{type}</option>)}</select></label>
            <label>Emergency Contact Name<input value={form.emergencyContactName} onChange={event => setForm({...form,emergencyContactName:event.target.value})}/></label>
            <label>Emergency Contact Number<input type="tel" value={form.emergencyContactPhone} onChange={event => setForm({...form,emergencyContactPhone:event.target.value})}/></label>
            <label>Photo<input type="file" accept="image/*" onChange={choosePhoto}/></label>
            <label className="record-modal-wide">Address<textarea rows="2" value={form.address} onChange={event => setForm({...form,address:event.target.value})}/></label>
          </div>
          <div className="record-modal-footer"><button type="button" className="secondary" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="primary" disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button></div>
        </form>}
      </section>
    </div>}
  </div>
}
