import {barangays} from '../utils/barangays'
import {buildRecordAddress} from '../utils/recordAddress'
import React, {useRef,useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {Camera, Save, UserRound} from 'lucide-react'
import CameraCapture from '../components/CameraCapture'
import {createRecord, notifyRecordsUpdated} from '../utils/recordsApi'
import {disabilityTypes, specificDisabilities} from '../utils/disabilities'
import {civilStatuses} from '../utils/civilStatuses'
import {validateRecordForm} from '../utils/validateRecordForm'
import {getSession} from '../utils/storage'

const empty = {pwdId:'',lastName:'',firstName:'',middleName:'',gender:'',birthdate:'',age:'',barangay:'',zone:'',disabilityType:'',disabilities:[],contact:'',civilStatus:'',bloodType:'',emergencyContactName:'',emergencyContactPhone:'',photo:''}

function ageFromDate(value) {
  if (!value) return ''
  const birth = new Date(`${value}T00:00:00`)
  if (Number.isNaN(birth.getTime())) return ''
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age--
  return Math.max(0,age)
}

export default function AddRecord() {
  const navigate = useNavigate()
  const [form,setForm] = useState(empty)
  const [saving,setSaving] = useState(false)
  const [message,setMessage] = useState('')
  const [cameraOpen,setCameraOpen] = useState(false)
  const photoInput = useRef(null)

  function closeCamera() {
    setCameraOpen(false)
  }

  function update(name,value) {
    setForm(previous => ({...previous,[name]:value,...(name === 'birthdate' ? {age:ageFromDate(value)} : {}),...(name === 'disabilityType' && value !== 'Multiple Disabilities' ? {disabilities:[]} : {})}))
  }

  function toggleDisability(type) {
    setForm(previous => ({...previous,disabilities:previous.disabilities.includes(type) ? previous.disabilities.filter(item => item !== type) : [...previous.disabilities,type]}))
  }

  function choosePhoto(event) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/') || file.size > 400000) {
      setMessage('Choose an image smaller than 400 KB.'); event.target.value = ''; return
    }
    const reader = new FileReader()
    reader.onload = () => {update('photo',String(reader.result));setMessage('')}
    reader.onerror = () => setMessage('Could not read the photo.')
    reader.readAsDataURL(file)
  }

  async function save(event) {
    event.preventDefault()
    if (saving) return
    if (!validateRecordForm(event.currentTarget)) return
    if (form.disabilityType === 'Multiple Disabilities' && form.disabilities.length < 2) {
      setMessage('Select at least two specific disabilities.'); return
    }
    try {
      setSaving(true); setMessage('')
      const address = buildRecordAddress(form.zone,form.barangay)
      const saved = await createRecord({...form,pwdId:form.pwdId.trim(),age:Number(form.age) || 0,address,status:'Active',addedBy:getSession()?.username || 'Unknown'})
      notifyRecordsUpdated()
      navigate(`/records/${encodeURIComponent(saved.pwdId)}`)
    } catch (error) {setMessage(`Could not save record: ${error.message}`)}
    finally {setSaving(false)}
  }

  return <div className="add-record-page">
    <header className="add-page-heading">
      <div><h1>Add New Record</h1><p>Register a person with disability using their official MSWD details.</p></div>
      <small><span className="add-required" aria-hidden="true">*</span> Required fields</small>
    </header>
    <form className="add-form-panel" onSubmit={save} noValidate aria-busy={saving} onInput={event => event.target.setCustomValidity?.('')}>
      {message && <div className="add-message" role="alert">{message}</div>}
      <section className="add-form-section" aria-labelledby="add-registration-heading">
        <header className="add-section-heading"><h2 id="add-registration-heading">Registration Details</h2><span className="add-status-badge">Status: Active</span></header>
        <div className="add-registration-grid">
          <label className="add-pwd-id" htmlFor="pwd-id">PWD ID Number <span className="add-required" aria-hidden="true">*</span>
            <input id="pwd-id" name="pwdId" type="text" autoComplete="off" maxLength={100} placeholder="Enter the MSWD-issued PWD ID" value={form.pwdId} onChange={event => update('pwdId',event.target.value)} required/>
          </label>
          <div className="add-photo-field">
            <span className="add-photo-preview">{form.photo ? <img src={form.photo} alt="Selected PWD photo"/> : <UserRound size={36} aria-hidden="true"/>}</span>
            <div className="add-photo-controls">
              <label htmlFor="profile-photo">Profile Photo <span className="add-optional">(optional)</span></label>
              <input id="profile-photo" ref={photoInput} type="file" accept="image/*" onChange={choosePhoto} disabled={saving} aria-describedby="profile-photo-hint" hidden/>
              <div className="add-photo-actions">
                <button className="add-choose-photo" type="button" disabled={saving} onClick={() => photoInput.current?.click()}>Choose a Photo</button>
                <button className="add-take-photo" type="button" disabled={saving} onClick={() => setCameraOpen(true)}><Camera size={15} aria-hidden="true"/> Take a Photo</button>
              </div>
              <small role="status">{form.photo ? 'Photo selected.' : 'No photo selected.'}</small>
              <small id="profile-photo-hint">For the record and ID card. Maximum 400 KB.</small>
              {form.photo && <button type="button" disabled={saving} onClick={() => {update('photo','');if (photoInput.current) photoInput.current.value = ''}}>Remove photo</button>}
            </div>
          </div>
        </div>
      </section>

      <section className="add-form-section" aria-labelledby="add-personal-heading">
        <header className="add-section-heading"><h2 id="add-personal-heading">Personal Information</h2></header>
        <div className="add-form-grid">
          <label>Last Name <span className="add-required" aria-hidden="true">*</span><input name="lastName" autoComplete="family-name" placeholder="Enter last name" value={form.lastName} onChange={event => update('lastName',event.target.value)} required/></label>
          <label>First Name <span className="add-required" aria-hidden="true">*</span><input name="firstName" autoComplete="given-name" placeholder="Enter first name" value={form.firstName} onChange={event => update('firstName',event.target.value)} required/></label>
          <label>Middle Name <span className="add-optional">(optional)</span><input name="middleName" autoComplete="additional-name" placeholder="Enter middle name" value={form.middleName} onChange={event => update('middleName',event.target.value)}/></label>
          <label>Birthdate <span className="add-required" aria-hidden="true">*</span><input name="birthdate" type="date" value={form.birthdate} onChange={event => update('birthdate',event.target.value)} max={new Date().toISOString().slice(0,10)} required/></label>
          <label>Age<input name="age" type="number" min="0" max="120" placeholder="Years" value={form.age} onChange={event => update('age',event.target.value)}/></label>
          <fieldset className="add-gender"><legend>Gender <span className="add-required" aria-hidden="true">*</span></legend><label><input type="radio" name="gender" required value="Male" checked={form.gender === 'Male'} onChange={event => update('gender',event.target.value)}/> Male</label><label><input type="radio" name="gender" required value="Female" checked={form.gender === 'Female'} onChange={event => update('gender',event.target.value)}/> Female</label></fieldset>
        </div>
      </section>

      <section className="add-form-section" aria-labelledby="add-address-heading">
        <header className="add-section-heading"><h2 id="add-address-heading">Address and Contact</h2></header>
        <div className="add-form-grid">
          <label>Barangay <span className="add-required" aria-hidden="true">*</span><select name="barangay" value={form.barangay} onChange={event => update('barangay',event.target.value)} required><option value="">Select barangay</option>{barangays.map(value => <option key={value}>{value}</option>)}</select></label>
          <label>Zone / Street <span className="add-required" aria-hidden="true">*</span><input name="zone" placeholder="Enter zone or street" value={form.zone} onChange={event => update('zone',event.target.value)} required/></label>
          <label>Contact Number <span className="add-required" aria-hidden="true">*</span><input name="contact" type="tel" placeholder="09XXXXXXXXX" value={form.contact} onChange={event => update('contact',event.target.value)} required/></label>
        </div>
      </section>

      <section className="add-form-section" aria-labelledby="add-disability-heading">
        <header className="add-section-heading"><h2 id="add-disability-heading">Disability and ID Card Details</h2></header>
        <div className="add-form-grid">
          <label>Disability Type <span className="add-required" aria-hidden="true">*</span><select name="disabilityType" value={form.disabilityType} onChange={event => update('disabilityType',event.target.value)} required><option value="">Select disability type</option>{disabilityTypes.map(value => <option key={value}>{value}</option>)}</select></label>
          <label>Civil Status <span className="add-required" aria-hidden="true">*</span><select name="civilStatus" value={form.civilStatus} onChange={event => update('civilStatus',event.target.value)} required><option value="">Select civil status</option>{civilStatuses.map(value=><option key={value}>{value}</option>)}</select></label>
          <label>Blood Type <span className="add-required" aria-hidden="true">*</span><select name="bloodType" value={form.bloodType} onChange={event => update('bloodType',event.target.value)} required><option value="">Select blood type</option>{['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(type => <option key={type}>{type}</option>)}</select></label>
        </div>
        {form.disabilityType === 'Multiple Disabilities' && <fieldset className="add-specific-disabilities"><legend>Specific Disabilities <span className="add-required" aria-hidden="true">*</span></legend><p>Select at least two disabilities that apply.</p><div>{specificDisabilities.map(type => <label key={type}><input type="checkbox" name="specificDisabilities" checked={form.disabilities.includes(type)} onChange={() => toggleDisability(type)}/>{type}</label>)}</div></fieldset>}
      </section>

      <section className="add-form-section" aria-labelledby="add-emergency-heading">
        <header className="add-section-heading"><h2 id="add-emergency-heading">Emergency Contact</h2></header>
        <div className="add-form-grid add-grid-two">
          <label>Emergency Contact Name <span className="add-required" aria-hidden="true">*</span><input name="emergencyContactName" placeholder="Enter full name" value={form.emergencyContactName} onChange={event => update('emergencyContactName',event.target.value)} required/></label>
          <label>Emergency Contact Number <span className="add-required" aria-hidden="true">*</span><input name="emergencyContactPhone" type="tel" placeholder="09XXXXXXXXX" value={form.emergencyContactPhone} onChange={event => update('emergencyContactPhone',event.target.value)} required/></label>
        </div>
      </section>

      <footer className="add-form-actions">
        <p>Review the details before saving.</p>
        <div className="add-action-buttons"><button className="secondary" type="button" onClick={() => navigate('/records')} disabled={saving}>Cancel</button><button className="primary" type="submit" disabled={saving}><Save size={17} aria-hidden="true"/>{saving ? 'Saving...' : 'Save Record'}</button></div>
      </footer>
    </form>
    {cameraOpen && <CameraCapture onClose={closeCamera} onCapture={photo => {update('photo',photo);setMessage('');if (photoInput.current) photoInput.current.value = ''}}/>}
  </div>
}
