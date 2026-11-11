import {barangays} from '../utils/barangays'
import {buildRecordAddress} from '../utils/recordAddress'
import React, {useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {Save, UserRound} from 'lucide-react'
import {createRecord, notifyRecordsUpdated} from '../utils/recordsApi'
import {disabilityTypes, specificDisabilities} from '../utils/disabilities'
import {validateRecordForm} from '../utils/validateRecordForm'
import {getSession} from '../utils/storage'

const empty = {lastName:'',firstName:'',middleName:'',gender:'',birthdate:'',age:'',barangay:'',zone:'',disabilityType:'',disabilities:[],contact:'',civilStatus:'',bloodType:'',emergencyContactName:'',emergencyContactPhone:'',photo:''}

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
      const saved = await createRecord({...form,age:Number(form.age) || 0,address,status:'Active',addedBy:getSession()?.username || 'Unknown'})
      notifyRecordsUpdated()
      navigate(`/records/${saved.pwdId}`)
    } catch (error) {setMessage(`Could not save record: ${error.message}`)}
    finally {setSaving(false)}
  }

  return <div className="add-record-page">
    <h1>Add New Record</h1>
    <section className="add-form-panel"><h2>Personal Information</h2>
      {message && <div className="add-message">{message}</div>}
      <form onSubmit={save} noValidate onInput={event => event.target.setCustomValidity?.('')}>
        <div className="add-form-grid">
          <label>Last Name <span>*</span><input placeholder="Enter Last Name" value={form.lastName} onChange={event => update('lastName',event.target.value)} required/></label>
          <label>First Name <span>*</span><input placeholder="Enter First Name" value={form.firstName} onChange={event => update('firstName',event.target.value)} required/></label>
          <label>Middle Name<input placeholder="Middle Name (Optional)" value={form.middleName} onChange={event => update('middleName',event.target.value)}/></label>
          <div className="add-photo-field"><span className="add-photo-preview">{form.photo ? <img src={form.photo} alt="Selected PWD photo"/> : <UserRound size={30}/>}</span><label>Photo for record and ID card<input type="file" accept="image/*" onChange={choosePhoto}/><small>Optional image, up to 400 KB</small></label>{form.photo && <button type="button" onClick={() => update('photo','')}>Remove photo</button>}</div>
          <fieldset className="add-gender"><legend>Gender <span>*</span></legend><label><input type="radio" name="gender" required value="Male" checked={form.gender === 'Male'} onChange={event => update('gender',event.target.value)}/> Male</label><label><input type="radio" name="gender" required value="Female" checked={form.gender === 'Female'} onChange={event => update('gender',event.target.value)}/> Female</label></fieldset>
          <label>Birthdate <span>*</span><input type="date" value={form.birthdate} onChange={event => update('birthdate',event.target.value)} max={new Date().toISOString().slice(0,10)} required/></label>
          <label>Age<input type="number" min="0" max="120" value={form.age} onChange={event => update('age',event.target.value)}/></label>
          <div className="add-address-group"><span>Address</span><div><label>Barangay <span>*</span><select value={form.barangay} onChange={event => update('barangay',event.target.value)} required><option value="">Barangay</option>{barangays.map(value => <option key={value}>{value}</option>)}</select></label><label>Zone / Street <span>*</span><input placeholder="Zone or street" value={form.zone} onChange={event => update('zone',event.target.value)} required/></label></div></div>
          <label>Disability Type <span>*</span><select value={form.disabilityType} onChange={event => update('disabilityType',event.target.value)} required><option value="">Select disability type</option>{disabilityTypes.map(value => <option key={value}>{value}</option>)}</select></label>
          {form.disabilityType === 'Multiple Disabilities' && <fieldset className="add-specific-disabilities"><legend>Specific Disabilities <span>*</span></legend><p>Select at least two disabilities that apply.</p><div>{specificDisabilities.map(type => <label key={type}><input type="checkbox" name="specificDisabilities" checked={form.disabilities.includes(type)} onChange={() => toggleDisability(type)}/>{type}</label>)}</div></fieldset>}
          <label>Contact Number <span>*</span><input type="tel" placeholder="Enter contact number" value={form.contact} onChange={event => update('contact',event.target.value)} required/></label>
          <label>Status<div className="add-fixed-status" aria-label="Status: Active">Active</div></label>
          <div className="add-id-extras"><h3>ID Card Details</h3><div><label>Civil Status <span>*</span><select value={form.civilStatus} onChange={event => update('civilStatus',event.target.value)} required><option value="">Select civil status</option><option>Single</option><option>Married</option><option>Widowed</option><option>Separated</option></select></label><label>Blood Type <span>*</span><select value={form.bloodType} onChange={event => update('bloodType',event.target.value)} required><option value="">Select blood type</option>{['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(type => <option key={type}>{type}</option>)}</select></label><label>Emergency Contact Name <span>*</span><input value={form.emergencyContactName} onChange={event => update('emergencyContactName',event.target.value)} required/></label><label>Emergency Contact Number <span>*</span><input type="tel" value={form.emergencyContactPhone} onChange={event => update('emergencyContactPhone',event.target.value)} required/></label></div></div>
        </div>
        <div className="add-form-actions"><button type="button" onClick={() => navigate('/records')} disabled={saving}>Cancel</button><button type="submit" disabled={saving}><Save size={17}/>{saving ? 'Saving...' : 'Save Record'}</button></div>
      </form>
    </section>
  </div>
}
