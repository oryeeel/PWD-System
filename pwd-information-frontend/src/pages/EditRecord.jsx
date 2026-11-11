import {apiFetch} from '../utils/apiFetch'
import {barangays} from '../utils/barangays'
import {buildRecordAddress,recordZone} from '../utils/recordAddress'
import {validateRecordForm} from '../utils/validateRecordForm'
import React, {
  useEffect,
  useState,
} from "react";
import { notifyRecordsUpdated } from '../utils/recordsApi';

import {
  useNavigate,
  useParams,
} from "react-router-dom";
import {disabilityTypes, specificDisabilities} from '../utils/disabilities';

export default function EditRecord() {
  const { id } = useParams();
  const nav = useNavigate();

  const [form, setForm] = useState({
    pwdId: "",
    firstName: "",
    middleName: "",
    lastName: "",
    birthdate: "",
    age: "",
    barangay: "",
    contact: "",
    zone: "",
    gender: "",
    disabilityType: "",
    disabilities: [],
    civilStatus: "",
    bloodType: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    photo: "",
    status: "Active",
  });

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState("");

  // ==========================================
  // LOAD THE SELECTED PERSON FROM MONGODB
  // ==========================================
  useEffect(() => {
    async function loadRecord() {
      try {
        setLoading(true);
        setError("");

        console.log(
          "Loading MongoDB record:",
          id
        );

        const response = await apiFetch(
          `http://localhost:8081/api/records/${id}`
        );

        const data =
          await response.json();

        console.log(
          "MongoDB returned:",
          data
        );

        if (!response.ok) {
          throw new Error(
            data.message ||
              "Record not found"
          );
        }

        setForm({
          pwdId:
            data.pwdId || "",

          firstName:
            data.firstName || "",

          middleName:
            data.middleName || "",

          lastName:
            data.lastName || "",

          birthdate:
            data.birthdate || "",

          age:
            data.age ?? "",

          barangay:
            data.barangay || "",

          contact:
            data.contact || "",

          zone: recordZone(data),

          gender:
            data.gender || "",

          disabilityType:
            data.disabilityType || "",

          disabilities:
            data.disabilities || [],
          civilStatus: data.civilStatus || "",
          bloodType: data.bloodType || "",
          emergencyContactName: data.emergencyContactName || "",
          emergencyContactPhone: data.emergencyContactPhone || "",
          photo: data.photo || "",

          status:
            data.status || "Active",
        });

      } catch (err) {
        console.error(
          "Failed to load record:",
          err
        );

        setError(
          err.message ||
            "Failed to load record"
        );
      } finally {
        setLoading(false);
      }
    }

    loadRecord();
  }, [id]);

  // ==========================================
  // HANDLE INPUT
  // ==========================================
  function change(e) {
    const {
      name,
      value,
    } = e.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
      ...(name === 'disabilityType' && value !== 'Multiple Disabilities' ? {disabilities: []} : {}),
    }));
  }

  // ==========================================
  // UPDATE RECORD IN MONGODB
  // ==========================================
  async function submit(e) {
    e.preventDefault();
    if (saving || !validateRecordForm(e.currentTarget)) return;
    if (!barangays.includes(form.barangay)) { alert('Select a valid barangay.'); return; }
    if (form.disabilityType === 'Multiple Disabilities' && form.disabilities.length < 2) {
      alert('Select at least two specific disabilities.');
      return;
    }

    try {
      setSaving(true);

      const response = await apiFetch(
        `http://localhost:8081/api/records/${id}`,
        {
          method: "PUT",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            firstName:
              form.firstName,

            middleName:
              form.middleName,

            lastName:
              form.lastName,

            birthdate:
              form.birthdate,

            age:
              Number(form.age) || 0,

            barangay:
              form.barangay,

            contact:
              form.contact,

            address:
              buildRecordAddress(form.zone,form.barangay),

            gender:
              form.gender,

            disabilityType:
              form.disabilityType,

            disabilities:
              form.disabilities,
            civilStatus: form.civilStatus,
            bloodType: form.bloodType,
            emergencyContactName: form.emergencyContactName,
            emergencyContactPhone: form.emergencyContactPhone,
            photo: form.photo,

            status:
              form.status,
          }),
        }
      );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
            "Failed to update record"
        );
      }

      notifyRecordsUpdated();

      alert(
        "Record updated successfully."
      );

      nav("/records");

    } catch (err) {
      console.error(
        "Update error:",
        err
      );

      alert(
        `Failed to update record: ${err.message}`
      );

    } finally {
      setSaving(false);
    }
  }

  // ==========================================
  // LOADING
  // ==========================================
  if (loading) {
    return (
      <div className="empty">
        Loading record...
      </div>
    );
  }

  // ==========================================
  // ERROR
  // ==========================================
  if (error) {
    return (
      <div className="empty">
        {error}
      </div>
    );
  }

  return <div className="edit-record-page">
<div className="page-title"><div><h1>Edit PWD Record</h1><p>{form.pwdId}</p></div></div>
<section className="panel"><form className="record-form" onSubmit={submit} noValidate onInput={event => event.target.setCustomValidity?.('')}>
<section className="edit-form-section" aria-labelledby="edit-section-0"><h2 id="edit-section-0">Personal Information</h2><div className="edit-fields edit-fields-personal"><label>
              Last Name <span>*</span>

              <input
                name="lastName"
                type="text"
                value={
                  form.lastName
                }
                onChange={change}
                required
              />
            </label>
<label>
              First Name <span>*</span>

              <input
                name="firstName"
                type="text"
                value={
                  form.firstName
                }
                onChange={change}
                required
              />
            </label>
<label>
              Middle Name

              <input
                name="middleName"
                type="text"
                value={
                  form.middleName
                }
                onChange={change}
              />
            </label>
<label>
              Gender <span>*</span>

              <select
                name="gender" required
                value={
                  form.gender
                }
                onChange={change}
              >
                <option value="">
                  Select Gender
                </option>

                <option value="Male">
                  Male
                </option>

                <option value="Female">
                  Female
                </option>

              </select>
            </label>
<label>
              Birthdate <span>*</span>

              <input
                name="birthdate" required
                type="date"
                value={
                  form.birthdate
                }
                onChange={change}
              />
            </label>
<label>
              Age

              <input
                name="age"
                type="number"
                value={
                  form.age
                }
                onChange={change}
              />
            </label></div></section>
<section className="edit-form-section" aria-labelledby="edit-section-1"><h2 id="edit-section-1">Address and Contact</h2><div className="edit-fields "><label>
              Barangay <span>*</span>

              <select name="barangay" value={form.barangay} onChange={change} required>
                <option value="">Select barangay</option>
                {form.barangay && !barangays.includes(form.barangay) && <option value={form.barangay} disabled>{form.barangay} (choose a valid barangay)</option>}
                {barangays.map(value => <option key={value}>{value}</option>)}
              </select>
            </label>
<label>Zone / Street <span>*</span><input name="zone" placeholder="Zone or street" value={form.zone} onChange={change} required/></label>
<label>
              Contact Number <span>*</span>

              <input
                name="contact" required
                type="tel"
                value={
                  form.contact
                }
                onChange={change}
              />
            </label>
</div></section>
<section className="edit-form-section" aria-labelledby="edit-section-2"><h2 id="edit-section-2">Disability and Status</h2><div className="edit-fields "><label>
              Disability Type <span>*</span>

              <select
                name="disabilityType" required
                value={
                  form.disabilityType
                }
                onChange={change}
              ><option value="">Select disability type</option>{disabilityTypes.map(type => <option key={type}>{type}</option>)}</select>
            </label>
<label>
              Status

              <select
                name="status"
                value={
                  form.status
                }
                onChange={change}
              >
                <option value="Active">
                  Active
                </option>

                <option value="Inactive">
                  Inactive
                </option>
              </select>
            </label>{form.disabilityType === 'Multiple Disabilities' && <fieldset className="edit-specific-disabilities"><legend>Specific Disabilities</legend>{specificDisabilities.map(type => <label key={type}><input type="checkbox" checked={form.disabilities.includes(type)} onChange={() => setForm(previous => ({...previous,disabilities:previous.disabilities.includes(type) ? previous.disabilities.filter(item => item !== type) : [...previous.disabilities,type]}))}/>{type}</label>)}</fieldset>}</div></section>
<section className="edit-form-section" aria-labelledby="edit-section-3"><h2 id="edit-section-3">ID Card Details</h2><div className="edit-fields "><label>Civil Status <span>*</span><select name="civilStatus" value={form.civilStatus} onChange={change} required><option value="">Select civil status</option><option>Single</option><option>Married</option><option>Widowed</option><option>Separated</option></select></label>
<label>Blood Type <span>*</span><select name="bloodType" value={form.bloodType} onChange={change} required><option value="">Select blood type</option>{['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(type => <option key={type}>{type}</option>)}</select></label>
<label>Emergency Contact Name <span>*</span><input name="emergencyContactName" value={form.emergencyContactName} onChange={change} required/></label>
<label>Emergency Contact Number <span>*</span><input name="emergencyContactPhone" type="tel" value={form.emergencyContactPhone} onChange={change} required/></label></div></section>
<div className="form-actions"><button type="button" className="secondary" onClick={()=>nav(-1)}>Cancel</button><button type="submit" className="primary" disabled={saving}>{saving?'Updating...':'Update Record'}</button></div>
</form></section></div>;
}
