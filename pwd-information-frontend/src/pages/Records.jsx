import {barangays} from '../utils/barangays'
import React, {useEffect, useMemo, useRef, useState} from 'react'
import {Eye, Pencil, Archive, Printer, Search, RotateCcw, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, UserRound, X, Upload} from 'lucide-react'
import {Link, useSearchParams} from 'react-router-dom'
import ArchivedRecords from '../components/ArchivedRecords'
import {getSession} from '../utils/storage'
import {archiveRecord, updateRecordPhoto, useRecords, notifyRecordsUpdated} from '../utils/recordsApi'


const ageOptions = [
  ['0-19','0 - 19'], ['20-25','20 - 25'], ['26-35','26 - 35'],
  ['36-45','36 - 45'], ['46-60','46 - 60'], ['61+','61 and above'],
]

function matchesAge(age, range) {
  if (!range) return true
  const number = Number(age)
  if (Number.isNaN(number)) return false
  if (range === '61+') return number >= 61
  const [min,max] = range.split('-').map(Number)
  return number >= min && number <= max
}

export default function Records() {
  const [searchParams] = useSearchParams()
  const archived = searchParams.get('view') === 'archived'
  const isStaff = getSession()?.role === 'Staff'
  const {records,error,refresh} = useRecords()
  const [searchInput,setSearchInput] = useState('')
  const [query,setQuery] = useState('')
  const [age,setAge] = useState('')
  const [type,setType] = useState('')
  const [barangay,setBarangay] = useState('')
  const [page,setPage] = useState(1)
  const [pageSize,setPageSize] = useState(50)
  const [jumpPage,setJumpPage] = useState('')
  const [photoSaving,setPhotoSaving] = useState('')
  const [photoError,setPhotoError] = useState('')
  const [previewRecord,setPreviewRecord] = useState(null)
  const photoDialog = useRef(null)
  const photoInput = useRef(null)

  const types = useMemo(() => [...new Set(records.map(r => r.disabilityType).filter(Boolean))].sort(), [records])
  const filtered = useMemo(() => records.filter(record => {
    const haystack = [record.pwdId,record.firstName,record.middleName,record.lastName,record.disabilityType,record.barangay].join(' ').toLowerCase()
    return haystack.includes(query.trim().toLowerCase()) && matchesAge(record.age,age) &&
      (!type || record.disabilityType === type) && (!barangay || record.barangay === barangay)
  }).sort((a,b) => String(a.pwdId).localeCompare(String(b.pwdId))), [records,query,age,type,barangay])

  useEffect(() => {setPage(1);setJumpPage('')}, [query,age,type,barangay,pageSize])
  const totalPages = Math.max(1,Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page,totalPages)
  const start = (currentPage - 1) * pageSize
  const visible = filtered.slice(start,start + pageSize)
  const hasFilters = Boolean(query || age || type || barangay)

  function clearFilters() {
    setSearchInput(''); setQuery(''); setAge(''); setType(''); setBarangay(''); setPage(1)
  }

  async function archive(id) {
    if (!isStaff) return
    if (!window.confirm(`Archive ${id}? You can restore it later.`)) return
    try { await archiveRecord(id); notifyRecordsUpdated(); await refresh() }
    catch (err) { window.alert(`Failed to archive record: ${err.message}`) }
  }

  async function choosePhoto(event, record) {
    if (!isStaff) return
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type) || file.size > 400000) {
      setPhotoError('Choose a PNG, JPEG, WebP or GIF image smaller than 400 KB.')
      return
    }
    try {
      setPhotoSaving(record.pwdId)
      setPhotoError('')
      const photo = await new Promise((resolve,reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('Could not read the photo.'))
        reader.readAsDataURL(file)
      })
      await updateRecordPhoto(record.pwdId,photo)
      setPreviewRecord(previous => previous?.pwdId === record.pwdId ? {...previous,photo} : previous)
      notifyRecordsUpdated()
      await refresh()
    } catch (error) {setPhotoError(`Could not save photo: ${error.message}`)}
    finally {setPhotoSaving('')}
  }

  return <div className="records-page">
    <div className="page-title"><h1>{archived ? 'Archived Records' : 'PWD Records'}</h1><div className="records-header-actions">
      <Link className="secondary records-archive-button" to={archived ? '/records' : '/records?view=archived'}>{archived ? <ChevronLeft size={16}/> : <Archive size={16}/>}{archived ? 'Back to PWD Records' : 'Archived Records'}</Link>
      {isStaff && <Link className="primary records-add" to="/add">+ Add New Record</Link>}
    </div></div>
    {archived ? <ArchivedRecords/> : <section className="records-panel">
      {error && <div className="empty">Could not load records: {error}</div>}
      {photoError && <div className="records-photo-error" role="alert">{photoError}</div>}
      <form className="records-search" onSubmit={event => {event.preventDefault();setQuery(searchInput)}}>
        <div className="records-search-input"><Search size={17}/><input aria-label="Search records" placeholder="Search name, ID or keyword..." value={searchInput} onChange={event => setSearchInput(event.target.value)}/></div>
        <button type="submit">Search</button>
      </form>

      <div className="records-filters">
        <label>Age<select value={age} onChange={event => setAge(event.target.value)}><option value="">All ages</option>{ageOptions.map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>Disability Type<select value={type} onChange={event => setType(event.target.value)}><option value="">All disability types</option>{types.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Barangay<select value={barangay} onChange={event => setBarangay(event.target.value)}><option value="">All barangays</option>{barangays.map(value => <option key={value}>{value}</option>)}</select></label>
        <button type="button" className="records-clear clear-filters-button" data-active={Boolean(age || type || barangay)} disabled={!hasFilters && !searchInput} onClick={clearFilters}><RotateCcw size={15}/> Clear Filters</button>
      </div>

      <div className="records-table-scroll"><table className={`records-table records-table-balanced ${isStaff ? 'records-table-staff' : 'records-table-admin'}`}><colgroup><col className="records-col-number"/><col className="records-col-id"/><col className="records-col-name"/><col className="records-col-age"/><col className="records-col-gender"/><col className="records-col-disability"/><col className="records-col-barangay"/><col className="records-col-actions"/></colgroup><thead><tr><th scope="col">No.</th><th scope="col" className="records-id-number">ID Number</th><th scope="col" className="records-name-heading"><span>Full Name</span></th><th>Age</th><th>Gender</th><th>Disability Type</th><th>Barangay</th><th className="records-actions-heading">{getSession()?.role === 'Admin' ? 'Action' : 'Actions'}</th></tr></thead><tbody>
        {visible.map((record,index) => <tr key={record.pwdId}>
          <td>{start + index + 1}</td><td className="records-id-number">{record.pwdId}</td><td className="records-name-cell"><div className="record-name-with-photo"><span className="record-photo-picker"><button type="button" className="record-list-photo" title="View photo" aria-label={`View photo of ${record.firstName} ${record.lastName}`} onClick={() => {setPreviewRecord(record);setPhotoError('');photoDialog.current.showModal()}}>{record.photo ? <img src={record.photo} alt=""/> : <UserRound size={21} aria-hidden="true"/>}</button></span><span>{record.firstName} {record.middleName} {record.lastName}{photoSaving === record.pwdId && <small className="record-photo-saving">Saving photo...</small>}</span></div></td><td>{record.age}</td><td>{record.gender}</td><td>{record.disabilityType}{record.disabilityType === 'Multiple Disabilities' && <small className="record-specific-disabilities">{(record.disabilities || []).join(', ') || 'Details not recorded'}</small>}</td><td>{record.barangay}</td>
          <td><div className="record-actions"><Link className="view" title="View record" aria-label={`View ${record.pwdId}`} to={`/records/${record.pwdId}`}><Eye size={17}/></Link>{isStaff && <><Link className="edit" title="Edit record" aria-label={`Edit ${record.pwdId}`} to={`/records/${record.pwdId}/edit`}><Pencil size={16}/></Link><Link className="card" title="Print ID" aria-label={`Print ID for ${record.pwdId}`} to={`/records/${record.pwdId}/id`}><Printer size={17}/></Link></>}{isStaff && <button className="archive" title="Archive record" aria-label={`Archive ${record.pwdId}`} onClick={() => archive(record.pwdId)}><Archive size={16}/></button>}</div></td>
        </tr>)}
      </tbody></table>{!visible.length && <div className="empty">No records found.</div>}</div>

      <div className="records-footer records-pagination">
        <strong aria-live="polite">{filtered.length ? `${(start+1).toLocaleString()}–${(start+visible.length).toLocaleString()} of ${filtered.length.toLocaleString()} records` : '0 records'} {hasFilters && <span>(filtered)</span>}</strong>
        <label>Rows per page <select aria-label="Rows per page" value={pageSize} onChange={event => {setPageSize(Number(event.target.value));setPage(1)}}>{[20,50,100].map(size => <option key={size} value={size}>{size}</option>)}</select></label>
        <nav aria-label="PWD record pages">
          <button type="button" className="secondary" aria-label="First page" title="First page" disabled={currentPage === 1} onClick={() => setPage(1)}><ChevronsLeft size={18}/></button>
          <button type="button" className="secondary" aria-label="Previous page" title="Previous page" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={18}/></button>
          <span>Page {currentPage} of {totalPages}</span>
          <button type="button" className="secondary" aria-label="Next page" title="Next page" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={18}/></button>
          <button type="button" className="secondary" aria-label="Last page" title="Last page" disabled={currentPage === totalPages} onClick={() => setPage(totalPages)}><ChevronsRight size={18}/></button>
        </nav>
        <form onSubmit={event => {event.preventDefault();const target=Number(jumpPage);if (Number.isInteger(target) && target >= 1 && target <= totalPages) {setPage(target);setJumpPage('')}}}>
          <label>Go to page <input aria-label="Go to page" type="number" min="1" max={totalPages} step="1" required value={jumpPage} onChange={event => setJumpPage(event.target.value)}/></label>
          <button type="submit" className="secondary" disabled={!jumpPage}>Go</button>
        </form>
      </div>
    </section>}
    <dialog ref={photoDialog} className="records-photo-dialog" aria-labelledby="records-photo-title">
      {previewRecord && <>
        <header><h2 id="records-photo-title">{previewRecord.firstName} {previewRecord.lastName}</h2><button type="button" className="secondary" aria-label="Close photo preview" onClick={() => photoDialog.current.close()}><X size={20}/></button></header>
        <div className="records-photo-preview">{previewRecord.photo ? <img src={previewRecord.photo} alt={`${previewRecord.firstName} ${previewRecord.lastName}`}/> : <><UserRound size={90}/><p>No photo added yet.</p></>}</div>
        {photoError && <p className="records-photo-error" role="alert">{photoError}</p>}
        {isStaff && <footer><button type="button" className="primary" disabled={Boolean(photoSaving)} onClick={() => photoInput.current.click()}><Upload size={16}/> {photoSaving ? 'Saving...' : previewRecord.photo ? 'Replace Photo' : 'Add Photo'}</button><input ref={photoInput} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" aria-label="Choose profile photo" onChange={event => choosePhoto(event,previewRecord)}/><small>PNG, JPEG, WebP or GIF. Up to 400 KB.</small></footer>}
      </>}
    </dialog>
  </div>
}
