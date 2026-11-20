import {recordStaffEvent,apiFetch} from '../utils/apiFetch'
import React, {useEffect, useState} from 'react'
import {Link, useParams} from 'react-router-dom'
import {ArrowLeft, Printer, UserRound, ArrowRightLeft} from 'lucide-react'
import {createIdQr} from '../utils/idQr'
import {displayRecordAddress} from '../utils/recordAddress'

const dateText = value => {
  if (!value) return 'Not provided'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined,{month:'2-digit',day:'2-digit',year:'numeric'})
}
// Five-year validity follows the supplied sample ID layout.
const validUntil = value => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const month = date.getMonth()
  date.setFullYear(date.getFullYear() + 5)
  if (date.getMonth() !== month) date.setDate(0)
  return date
}
const text = value => value === 0 ? '0' : value || 'Not provided'

function IdField({label,value,wide=false}) {
  return <div className={`photo-id-field ${wide ? 'wide' : ''}`}><small>{label}</small><strong>{text(value)}</strong></div>
}

export default function IdCard() {
  const {id} = useParams()
  const [record,setRecord] = useState(null)
  const [qr,setQr] = useState('')
  const [side,setSide] = useState('front')
  const [error,setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const response = await apiFetch(`http://localhost:8081/api/records/${encodeURIComponent(id)}`)
        const data = await response.json()
        if (!response.ok) throw new Error(data.message || 'PWD record not found')
        const code = await createIdQr(data.pwdId)
        if (!cancelled) {setRecord(data);setQr(code);void recordStaffEvent('Viewed ID card',id)}
      } catch (err) {if (!cancelled) setError(err.message)}
    }
    load()
    return () => {cancelled = true}
  },[id])

  if (error) return <div className="empty">{error}</div>
  if (!record) return <div className="empty">Loading PWD ID...</div>

  const middleInitial = record.middleName?.trim() ? `${record.middleName.trim()[0].toUpperCase()}.` : ''
  const fullName = [record.lastName,[record.firstName,middleInitial].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  const disability = record.disabilityType === 'Multiple Disabilities'
    ? (record.disabilities || []).join(', ') || 'Multiple Disabilities'
    : record.disabilityType

  return <div className="id-view-page">
    <Link className="record-back" to="/records"><ArrowLeft size={18}/> Back to List</Link>
    <h1>View and Print PWD ID</h1>
    <section className="id-view-panel">
      <h2>ID Card ({side === 'front' ? 'Front' : 'Back'})</h2>
      <div className="id-print-cards">
        <div className={`photo-id-card front ${side === 'front' ? 'active' : ''}`}>
          <header className="photo-id-red-header"><div className="photo-id-agency"><img src="/dswd-white.svg" alt="DSWD logo"/><span className="photo-id-logo-label">DSWD</span></div><div><small>REPUBLIC OF THE PHILIPPINES</small><strong>Persons with Disability<br/>Identification Card</strong></div><div className="photo-id-emblem"><img src="/ncda-logo.png" alt="National Council on Disability Affairs seal"/></div></header>
          <div className="photo-id-front-body">
            <span className="photo-id-hologram" aria-hidden="true"/>
            <div className="photo-id-picture">{record.photo ? <img src={record.photo} alt={`Photo of ${fullName}`}/> : <><UserRound size={70}/><small>Photo not provided</small></>}</div>
            <div className="photo-id-information"><IdField label="Last Name, First Name, M.I." value={fullName} wide/><div className="photo-id-three"><IdField label="Sex" value={record.gender}/><IdField label="Civil Status" value={record.civilStatus}/><IdField label="Blood Type" value={record.bloodType}/></div><div className="photo-id-three"><IdField label="Date of Birth" value={dateText(record.birthdate)}/><IdField label="Date Issued" value={dateText(record.createdAt)}/><IdField label="Valid Until" value={dateText(validUntil(record.createdAt))}/></div><IdField label="Address" value={displayRecordAddress(record)} wide/><IdField label="Disability Type" value={disability} wide/><div className="photo-id-number">DIGITAL ID NO.: {record.pwdId}</div></div>
            <img className="photo-id-front-qr" src={qr} alt={`QR code containing ID ${record.pwdId}`}/>
          </div>
        </div>
        <div className={`photo-id-card back ${side === 'back' ? 'active' : ''}`}>
          <div className="photo-id-back-body photo-id-back-reference">
            <div className="photo-id-back-copy">
              <div className="photo-id-emergency"><small>IN CASE OF EMERGENCY, PLEASE CONTACT</small><strong>{text(record.emergencyContactName)}</strong><b>{text(record.emergencyContactPhone)}</b></div>
              <div className="photo-id-about"><span><img src="/pwd-accessibility.svg" alt="Wheelchair accessibility symbol"/></span><div><strong>PERSONS WITH DISABILITY</strong><p>The holder of this card is a person with disability and is entitled to privileges and benefits in accordance with RA 7277, 9442 and 10754 and its implementing rules and regulations.</p></div></div>
              <div className="photo-id-back-notes"><p>Any violation thereof is punishable by law.</p><p>This card is non-transferable</p><div className="photo-id-ncda-contacts"><p>National Council on Disability Affairs (NCDA):</p><p>Regional Program Coordinator: (632) 8932-64-22</p><p>Program Management Division: (632) 5310-47-63</p><p>Office of Executive Director: (632) 5310-47-61</p></div></div>
            </div>
            <div className="photo-id-large-qr"><img src={qr} alt={`QR code containing ID ${record.pwdId}`}/><small>Scan to read ID number: {record.pwdId}</small></div>
          </div>
        </div>
      </div>
      <div className="id-view-actions"><button onClick={() => setSide(side === 'front' ? 'back' : 'front')}><ArrowRightLeft size={17}/> View ID {side === 'front' ? 'Back' : 'Front'} Side</button><button onClick={() => window.print()}><Printer size={17}/> Print ID</button></div>
    </section>
  </div>
}
