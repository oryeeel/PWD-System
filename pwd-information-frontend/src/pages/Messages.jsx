import {apiFetch} from '../utils/apiFetch'
import React, {useEffect,useMemo,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {CalendarDays, ChevronLeft, ChevronRight, RotateCcw, Search, Send, Trash2, X} from 'lucide-react'
import {loadMessages,saveMessages} from '../utils/storage'
import {useRecords} from '../utils/recordsApi'
import {MAX_SMS_RECIPIENTS,MAX_SMS_CHARACTERS,PENDING_SMS_KEY,selectedSmsRecipients,toggleRecipientIds,selectMatchingRecipientIds,estimateSms,validateSms,smsPayloadKey,readPendingSms,smsResultSummary,smsConfirmation} from '../utils/sms'
import '../messages.css'

const PAGE_SIZE = 6
const messageTypes = ['Announcement','Schedule','Interview','Reminder']
const localDate = value => {
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
}
const formatDate = value => value ? new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—'
const blankForm = () => ({type:'Announcement',recipientIds:[],message:''})
const normalizedStatus = value => value === 'Archived' ? 'Deleted' : value === 'Queued' ? 'Sent' : ['Draft','Sent','Deleted','Partial','Failed','Unknown'].includes(value) ? value : 'Unknown'
const messageTab = value => ['Draft','Deleted'].includes(normalizedStatus(value)) ? normalizedStatus(value) : 'Sent'
const statusLabel = value => normalizedStatus(value) === 'Sent' ? 'Sent' : normalizedStatus(value) === 'Unknown' ? 'Unconfirmed' : normalizedStatus(value)
const resultStatusLabel = value => value === 'NotSent' ? 'Not sent' : value === 'Unknown' ? 'Unconfirmed' : value === 'Queued' ? 'Sent' : value
const resultMessage = value => {
  const message = String(value || '')
  if (/invalid token/i.test(message)) return 'IPROG rejected the configured API token. Verify the backend SMS configuration before retrying.'
  if (/sender name|sender id/i.test(message)) return 'IPROG requires an approved sender name for this network. Contact the SMS account administrator.'
  return message
}

export default function Messages() {
  const {records,error} = useRecords()
  const [messages,setMessages] = useState(loadMessages)
  const [tab,setTab] = useState('Sent')
  const [typeFilter,setTypeFilter] = useState('')
  const [from,setFrom] = useState(() => `${localDate(new Date()).slice(0,7)}-01`)
  const [to,setTo] = useState(() => localDate(new Date()))
  const [search,setSearch] = useState('')
  const [page,setPage] = useState(1)
  const [open,setOpen] = useState(false)
  const [viewing,setViewing] = useState(null)
  const [recipientPopup,setRecipientPopup] = useState(null)
  const recipientPopupTimer = useRef(null)
  const [recipientOpen,setRecipientOpen] = useState(false)
  const [recipientQuery,setRecipientQuery] = useState('')
  const [form,setForm] = useState(blankForm)
  const [editingId,setEditingId] = useState(null)
  const [draftCopy,setDraftCopy] = useState(false)
  const [notice,setNotice] = useState('')
  const [formError,setFormError] = useState('')
  const [sending,setSending] = useState(false)
  const [pendingSms,setPendingSms] = useState(() => readPendingSms(localStorage))
  const sendLock = useRef(false)

  useEffect(() => {
    if (!open && !viewing) return
    const escape = event => {if (event.key === 'Escape' && !sendLock.current) {setOpen(false);setViewing(null);setRecipientOpen(false)}}
    window.addEventListener('keydown',escape)
    return () => window.removeEventListener('keydown',escape)
  },[open,viewing])

  useEffect(() => () => clearTimeout(recipientPopupTimer.current),[])

  const filtered = useMemo(() => messages.filter(item => {
    const status = messageTab(item.status)
    const date = localDate(item.atIso || item.at || Date.now())
    const haystack = [item.title,item.message,item.text,item.type,item.to].join(' ').toLowerCase()
    return (status === tab) && (!typeFilter || item.type === typeFilter) && (['Draft','Deleted'].includes(tab) || ((!from || date >= from) && (!to || date <= to))) && haystack.includes(search.trim().toLowerCase())
  }).sort((a,b) => new Date(b.atIso || b.at) - new Date(a.atIso || a.at)),[messages,tab,typeFilter,from,to,search])
  const pages = Math.max(1,Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page,pages)
  const visible = filtered.slice((currentPage-1)*PAGE_SIZE,currentPage*PAGE_SIZE)
  const selectedRecipients = useMemo(() => selectedSmsRecipients(form.recipientIds,records),[form.recipientIds,records])
  const selectedCount = selectedRecipients.length
  const uniquePhoneCount = new Set(selectedRecipients.map(recipient => recipient.phoneNumber).filter(Boolean)).size
  const smsUsage = estimateSms(form.message)
  const recordsById = useMemo(() => new Map(records.map(record => [record.pwdId,record])),[records])
  const matchingRecipients = useMemo(() => records.filter(record => [record.pwdId,record.firstName,record.middleName,record.lastName,record.contact].join(' ').toLowerCase().includes(recipientQuery.trim().toLowerCase())).sort((a,b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)),[records,recipientQuery])
  const editingStatus = editingId ? normalizedStatus(messages.find(message => message.id === editingId)?.status) : null

  function setFilter(setter,value) {setter(value);setPage(1)}
  function showRecipients(event,item) {
    clearTimeout(recipientPopupTimer.current)
    const rect = event.currentTarget.getBoundingClientRect()
    setRecipientPopup({id:item.id,names:recipientNames(item),total:item.recipientCount ?? item.recipientIds?.length ?? recipientNames(item).length,left:Math.max(8,Math.min(rect.left,window.innerWidth-320)),top:rect.bottom+300 > window.innerHeight ? Math.max(8,rect.top-306) : rect.bottom+6})
  }
  function hideRecipientsSoon() {
    clearTimeout(recipientPopupTimer.current)
    recipientPopupTimer.current = setTimeout(() => setRecipientPopup(null),180)
  }
  function recipientNames(item) {
    if (item.recipientSnapshots?.length) return item.recipientSnapshots.map(recipient => `${recipient.name} (${recipient.pwdId}) - ${recipient.contact || 'No contact number'}`)
    const ids = item.recipientIds?.length ? item.recipientIds : item.sample ? records.slice(0,item.recipientCount || 0).map(record => record.pwdId) : []
    if (ids.length) return ids.map(id => {
      const record = recordsById.get(id)
      return record ? `${[record.firstName,record.middleName,record.lastName].filter(Boolean).join(' ')} (${id}) - ${record.contact || 'No contact number'}` : id
    }).sort((a,b) => a.localeCompare(b))
    return item.to ? [item.to] : []
  }
  function startNew() {setForm(blankForm());setEditingId(null);setDraftCopy(false);setFormError('');setRecipientOpen(false);setRecipientQuery('');setOpen(true)}
  function editMessage(item) {
    setForm({type:item.type || 'Announcement',recipientIds:item.recipientIds?.length ? item.recipientIds : item.sample ? records.slice(0,item.recipientCount || 0).map(record => record.pwdId) : [],message:item.message || item.text || ''})
    const copy = normalizedStatus(item.status) !== 'Draft'
    setEditingId(copy ? null : item.id);setDraftCopy(copy);setViewing(null);setFormError('');setRecipientOpen(false);setRecipientQuery('');setOpen(true)
  }
  function openMessage(item) {
    if (normalizedStatus(item.status) === 'Draft') editMessage(item)
    else setViewing(item)
  }
  function restoreMessage() {
    const status = ['Draft','Queued','Sent','Partial','Failed','Unknown'].includes(viewing.previousStatus) ? viewing.previousStatus : 'Unknown'
    const next = messages.map(item => item.id === viewing.id ? {...item,status,deletedAt:null} : item)
    saveMessages(next);setMessages(next);setViewing(null);setTab(messageTab(status));setPage(1)
    setNotice('Message restored. No SMS was sent.')
  }
  function deleteMessage(item = viewing) {
    const permanent = normalizedStatus(item.status) === 'Deleted'
    if (permanent && !window.confirm('Permanently delete this message from browser history? This cannot be undone.')) return
    const next = permanent ? messages.filter(message => message.id !== item.id) : messages.map(message => message.id === item.id ? {...message,previousStatus:message.status,status:'Deleted',deletedAt:new Date().toISOString()} : message)
    saveMessages(next);setMessages(next);setViewing(null);setOpen(false);setPage(1)
    if (!permanent) setTab('Deleted')
    setNotice(permanent ? 'Message permanently deleted.' : 'Message moved to Deleted Messages. You can restore it there. This does not cancel a submitted SMS.')
  }
  function toggleRecipient(id) {
    const recipientIds = toggleRecipientIds(form.recipientIds,id)
    if (recipientIds.length > MAX_SMS_RECIPIENTS) {setFormError(`Select no more than ${MAX_SMS_RECIPIENTS} recipients per batch.`);return}
    setForm(previous => {
      const nextIds = toggleRecipientIds(previous.recipientIds,id)
      return nextIds.length <= MAX_SMS_RECIPIENTS ? {...previous,recipientIds:nextIds} : previous
    });setFormError('')
  }
  function toggleMatchingRecipients(checked) {
    const ids = matchingRecipients.map(record => record.pwdId)
    const recipientIds = selectMatchingRecipientIds(form.recipientIds,ids,checked)
    if (recipientIds.length > MAX_SMS_RECIPIENTS) {setFormError(`This selection exceeds ${MAX_SMS_RECIPIENTS} recipients. Narrow the search or choose recipients individually.`);return}
    setForm(previous => {
      const nextIds = selectMatchingRecipientIds(previous.recipientIds,ids,checked)
      return nextIds.length <= MAX_SMS_RECIPIENTS ? {...previous,recipientIds:nextIds} : previous
    });setFormError('')
  }
  function resumePending() {
    const pending = readPendingSms(localStorage) || pendingSms
    if (!pending) return
    setPendingSms(pending);setForm(pending.submitted);setEditingId(pending.editingId || null);setDraftCopy(false)
    setFormError('The earlier submission is unconfirmed. Check IPROG history before continuing. Send Now reuses its request ID to recover the result safely; it will submit only if the server never received the earlier request.')
    setRecipientOpen(false);setRecipientQuery('');setOpen(true)
  }
  function storeHistory(submitted, status, data) {
    const id = data?.requestId || editingId || `draft-${Date.now()}`
    const item = {id,type:submitted.type,title:submitted.message.trim().split(/[.!?\n]/)[0].slice(0,48) || 'Untitled draft',message:submitted.message.trim(),recipientIds:submitted.recipientIds,recipientCount:submitted.recipientIds.length,status,atIso:new Date().toISOString(),
      ...(data ? {requestId:data.requestId,counts:data.counts,results:data.results,providerMessageId:data.providerMessageId,recipientSnapshots:selectedSmsRecipients(submitted.recipientIds,records)} : {})}
    const next = [item,...messages.filter(message => message.id !== editingId && message.id !== id && (!data || message.requestId !== data.requestId))]
    saveMessages(next)
    setMessages(next);setTab(messageTab(status));setPage(1);setFrom(`${localDate(new Date()).slice(0,7)}-01`);setTo(localDate(new Date()));setOpen(false);setRecipientOpen(false)
  }
  async function save(status) {
    if (sendLock.current) return
    const submitted = {...form,message:form.message.trim(),recipientIds:[...new Set(form.recipientIds)]}
    if (status === 'Draft') {
      try {storeHistory(submitted,'Draft');setNotice('Draft saved in this browser. No SMS was sent.')}
      catch {setFormError('Draft could not be saved in browser storage.')}
      return
    }
    const existing = readPendingSms(localStorage) || pendingSms
    if (existing && smsPayloadKey(existing.submitted) !== smsPayloadKey(submitted)) {
      setFormError('An earlier SMS submission is still unconfirmed. Use Resume submission above to recover its result before sending another message. You can save this message as a draft.')
      return
    }
    if (!existing) {
      const validation = validateSms(submitted,selectedRecipients)
      if (validation) {setFormError(validation);return}
    }
    sendLock.current = true
    try {
      const confirmation = existing
        ? `Recover the result of this previous SMS submission to ${submitted.recipientIds.length} recipient(s)?\n\n${submitted.message}\n\nThe same request ID will be reused. A message is submitted only if the server never received the earlier request. Check the IPROG dashboard before continuing.`
        : smsConfirmation(submitted,selectedRecipients)
      if (!window.confirm(confirmation)) return
      const requestId = existing?.requestId || crypto.randomUUID()
      const pending = existing || {requestId,submitted,editingId,createdAt:new Date().toISOString()}
      // Persist before contacting the provider so closing the page cannot discard the retry identity.
      try {localStorage.setItem(PENDING_SMS_KEY,JSON.stringify(pending))}
      catch {setFormError('Browser storage is unavailable. SMS was not submitted because retry protection could not be saved.');return}
      setPendingSms(pending);setSending(true);setFormError('')
      let response,data
      try {
        response = await apiFetch('/api/messages/send', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipientIds:submitted.recipientIds,message:submitted.message,requestId})})
        data = await response.json()
      } catch {
        setFormError('SMS submission could not be confirmed. Check the IPROG dashboard before retrying. Send Now will reuse this request ID; do not create a duplicate message.')
        return
      }
      if (!response.ok) {
        if (!existing && [400,401,403,429].includes(response.status)) {
          localStorage.removeItem(PENDING_SMS_KEY);setPendingSms(null)
        }
        setFormError(data.message || 'Submission is unconfirmed. Check the IPROG dashboard before retrying with this request ID.')
        return
      }
      if (!data.counts || !Array.isArray(data.results) || data.requestId !== requestId) {
        setFormError('The SMS service returned an unrecognized result. Check the IPROG dashboard before retrying; this request ID has been retained.')
        return
      }
      try {storeHistory(submitted,data.status,data)}
      catch {
        setFormError(`${smsResultSummary(data.counts)} Browser history could not be saved. The request ID is retained; do not start a new submission.`)
        return
      }
      localStorage.removeItem(PENDING_SMS_KEY);setPendingSms(null)
      setNotice(`${smsResultSummary(data.counts)} ${data.counts.duplicates ? `${data.counts.duplicates} shared-number duplicate(s) avoided. ` : ''}IPROG accepted the submitted messages. Delivery status is confirmed through the provider when available. History is saved in this browser.`)
    } catch {
      setFormError('Could not complete this operation. Check the IPROG dashboard and resume the saved submission before sending again.')
    } finally {setSending(false);sendLock.current = false}
  }

  return <div className="staff-messages-page">
    <header className="messages-heading"><h1>Notify a Person</h1><p>Send text message notifications about schedules, interviews, announcements, and other important updates.</p></header>
    {error && <div className="error">Could not load PWD recipients: {error}</div>}
    {notice && <div className="messages-notice" role="status">{notice}</div>}
    {pendingSms && <div className="messages-pending" role="status"><span>An SMS submission has no saved result yet. Resume it to avoid duplicate messages.</span><button type="button" disabled={sending} onClick={resumePending}>Resume submission</button></div>}
    <div className="messages-tabs" role="tablist" aria-label="Message status">{[['Sent','SMS History'],['Draft','Drafts'],['Deleted','Deleted Messages']].map(([value,label]) => <button key={value} type="button" role="tab" aria-selected={tab === value} className={tab === value ? 'active' : ''} onClick={() => {setTab(value);setPage(1)}}>{label}</button>)}</div>
    <div className="messages-toolbar"><select aria-label="Filter message type" value={typeFilter} onChange={event => setFilter(setTypeFilter,event.target.value)}><option value="">All Types</option>{messageTypes.map(type => <option key={type}>{type}</option>)}</select>{!['Draft','Deleted'].includes(tab) && <div className="messages-date-range"><CalendarDays size={16}/><input aria-label="From date" type="date" value={from} onChange={event => setFilter(setFrom,event.target.value)}/><span>–</span><input aria-label="To date" type="date" value={to} onChange={event => setFilter(setTo,event.target.value)}/></div>}<div className="messages-search"><input aria-label="Search messages" placeholder="Search message..." value={search} onChange={event => setFilter(setSearch,event.target.value)}/><Search size={16}/></div><button className="messages-new" onClick={startNew}><Send size={16}/> New Message</button></div>
    <div className="messages-table-scroll"><table className="messages-table"><thead><tr><th>Message</th><th>Type</th><th>Recipients</th><th>Date Saved</th><th>Status</th></tr></thead><tbody>{visible.map(item => <tr key={item.id}><td><button className="messages-title-button" onClick={() => openMessage(item)}>{item.title || item.to || 'Untitled message'}</button>{item.sample && <span className="messages-example-badge">Example</span>}<small>{item.message || item.text || 'No message text'}</small></td><td><span className={`messages-type ${String(item.type || 'Announcement').toLowerCase()}`}>{item.type || 'Announcement'}</span></td><td className="messages-recipient-cell"><button type="button" className="messages-recipient-count" aria-label={`View ${item.recipientCount ?? item.recipientIds?.length ?? recipientNames(item).length} recipients`} aria-expanded={recipientPopup?.id === item.id} aria-describedby={recipientPopup?.id === item.id ? 'messages-recipient-popup' : undefined} onMouseEnter={event => showRecipients(event,item)} onMouseLeave={hideRecipientsSoon} onFocus={event => showRecipients(event,item)} onBlur={hideRecipientsSoon} onClick={event => showRecipients(event,item)}>{item.recipientCount ?? item.recipientIds?.length ?? recipientNames(item).length}</button></td><td>{formatDate(item.atIso || item.at)}</td><td><span className={`messages-status ${normalizedStatus(item.status).toLowerCase()}`}>{statusLabel(item.status)}</span>{item.counts && <small className="messages-result-counts">{smsResultSummary(item.counts)}</small>}</td></tr>)}</tbody></table>{!visible.length && <div className="empty">No {tab === 'Sent' ? 'SMS history' : tab.toLowerCase()} messages match these filters.</div>}</div>
    <footer className="messages-footer"><span>Showing {filtered.length ? (currentPage-1)*PAGE_SIZE+1 : 0} to {Math.min(currentPage*PAGE_SIZE,filtered.length)} of {filtered.length} entries</span><div><button aria-label="Previous page" disabled={currentPage===1} onClick={() => setPage(currentPage-1)}><ChevronLeft size={17}/></button><b>{currentPage}</b><button aria-label="Next page" disabled={currentPage===pages} onClick={() => setPage(currentPage+1)}><ChevronRight size={17}/></button></div></footer>
    {recipientPopup && createPortal(<div id="messages-recipient-popup" className="messages-recipient-popup" role="tooltip" style={{left:recipientPopup.left,top:recipientPopup.top}} onMouseEnter={() => clearTimeout(recipientPopupTimer.current)} onMouseLeave={hideRecipientsSoon}><strong>Total Recipients: {recipientPopup.total}</strong>{recipientPopup.names.length ? <ol>{recipientPopup.names.map((name,index) => <li key={`${name}-${index}`}>{name}</li>)}</ol> : <p>Recipient details unavailable.</p>}</div>,document.body)}
    {viewing && <div className="messages-modal-backdrop" onMouseDown={() => setViewing(null)}><section className="messages-modal messages-view-modal" role="dialog" aria-modal="true" aria-label="View message history" onMouseDown={event => event.stopPropagation()}><header><h2>{viewing.title || 'Message'}</h2><button aria-label="Close popup" onClick={() => setViewing(null)}><X size={20}/></button></header><dl><div><dt>Type</dt><dd>{viewing.type || 'Announcement'}</dd></div><div className="messages-view-recipient-field"><dt>Recipients</dt><dd>{recipientNames(viewing).length ? <ul className="messages-view-recipients">{recipientNames(viewing).map((name,index) => <li key={`${name}-${index}`}>{name}</li>)}</ul> : 'Recipient details unavailable'}</dd></div><div><dt>Date Saved</dt><dd>{formatDate(viewing.atIso || viewing.at)}</dd></div><div><dt>Status</dt><dd>{statusLabel(viewing.status)}</dd></div></dl><div className="messages-view-body">{viewing.message || viewing.text || 'No message text'}</div>
      {viewing.counts && <p className="messages-submission-summary">{smsResultSummary(viewing.counts)} {viewing.counts.duplicates > 0 && `${viewing.counts.duplicates} shared-number duplicate(s) avoided.`}</p>}
      {viewing.results?.length > 0 && <ul className="messages-submission-results" aria-label="SMS submission results">{viewing.results.map((result,index) => <li key={`${result.phoneNumber}-${index}`}><div><strong>{result.phoneNumber}</strong><span className={`messages-status ${result.status.toLowerCase()}`}>{resultStatusLabel(result.status)}</span></div><small>{result.recipientIds.map(id => viewing.recipientSnapshots?.find(recipient => recipient.pwdId === id)?.name || id).join(', ')}</small>{result.providerMessageId && <small>Provider ID: {result.providerMessageId}</small>}{result.message && <p>{resultMessage(result.message)}</p>}</li>)}</ul>}
      <footer>{messageTab(viewing.status) === 'Sent' && <button type="button" onClick={() => editMessage(viewing)}>Edit as Draft</button>}{normalizedStatus(viewing.status) === 'Deleted' && <button type="button" onClick={restoreMessage}><RotateCcw size={16}/> Restore</button>}<button type="button" className="messages-delete" onClick={() => deleteMessage()}><Trash2 size={16}/> {normalizedStatus(viewing.status) === 'Deleted' ? 'Delete Permanently' : 'Delete'}</button></footer></section></div>}
    {open && <div className="messages-modal-backdrop" onMouseDown={() => {if (!sendLock.current) setOpen(false)}}><section className="messages-modal" aria-busy={sending} role="dialog" aria-modal="true" aria-label={draftCopy ? 'Edit Message as Draft' : editingId ? 'Edit Message' : 'Send New SMS'} onMouseDown={event => event.stopPropagation()}><header><h2>{draftCopy ? 'Edit Message as Draft' : editingId ? 'Edit Message' : 'Send New SMS'}</h2><button aria-label="Close popup" disabled={sending} onClick={() => setOpen(false)}><X size={20}/></button></header>
      {draftCopy && <p className="messages-notice">Editing a draft copy. The original SMS history is preserved. Saving this draft uses no SMS credits.</p>}{formError && <div className="error" role="alert">{formError}</div>}
      {pendingSms && !sending && <div className="messages-pending"><span>A previous submission needs a result.</span><button type="button" onClick={resumePending}>Resume submission</button></div>}
      <fieldset disabled={sending} className="messages-modal-grid" style={{border:0,padding:0,margin:0,minWidth:0}}>
        <label>Message Type <em>*</em><select value={form.type} onChange={event => setForm({...form,type:event.target.value})}>{messageTypes.map(type => <option key={type}>{type}</option>)}</select></label>
        <div className="messages-recipient-field">
          <strong id="messages-recipient-label">Recipients <em>*</em></strong>
          <button type="button" className="messages-recipient-toggle" aria-labelledby="messages-recipient-label" aria-expanded={recipientOpen} aria-controls="messages-recipient-menu" onClick={() => setRecipientOpen(!recipientOpen)}>{selectedCount ? `${selectedCount} recipient${selectedCount === 1 ? '' : 's'} selected` : 'Select Recipients'} <span aria-hidden="true">⌄</span></button>
          {recipientOpen && <div className="messages-recipient-menu" id="messages-recipient-menu"><div className="messages-recipient-search"><Search size={15}/><input type="search" autoFocus aria-label="Search PWD by ID, name, or contact number" placeholder="Enter PWD ID, name, or number..." value={recipientQuery} onChange={event => setRecipientQuery(event.target.value)} onKeyDown={event => {if (event.key === 'Enter' && matchingRecipients.length) {event.preventDefault();toggleRecipient(matchingRecipients[0].pwdId)} if (event.key === 'Escape') {event.stopPropagation();setRecipientOpen(false)}}}/></div><div className="messages-recipient-results"><label><input type="checkbox" checked={matchingRecipients.length > 0 && matchingRecipients.every(record => form.recipientIds.includes(record.pwdId))} onChange={event => toggleMatchingRecipients(event.target.checked)}/> {recipientQuery ? `Select all ${matchingRecipients.length} matching records` : 'All PWD records'}</label>{matchingRecipients.map(record => <label key={record.pwdId}><input type="checkbox" checked={form.recipientIds.includes(record.pwdId)} onChange={() => toggleRecipient(record.pwdId)}/>{record.firstName} {record.middleName} {record.lastName} ({record.pwdId}) - {record.contact || 'No contact number'}</label>)}{!matchingRecipients.length && <p>No PWD found for this ID, name, or number.</p>}</div></div>}
          <section className="messages-selected" aria-label="Selected recipients">
            <strong className="messages-selected-count" aria-live="polite">Selected recipients: {selectedCount} / {MAX_SMS_RECIPIENTS}</strong>
            {selectedCount ? <ul className="messages-selected-list">{selectedRecipients.map(recipient => <li key={recipient.pwdId}><div><strong>{recipient.name}</strong><span>{recipient.contact || 'No contact number'}</span>{(!recipient.phoneNumber || recipient.missing) && <small className="messages-invalid-phone">{recipient.missing ? 'Record unavailable' : 'Invalid mobile number'}</small>}</div><button type="button" className="messages-remove-recipient" aria-label={`Remove ${recipient.name}`} onClick={() => toggleRecipient(recipient.pwdId)}><X size={16}/></button></li>)}</ul> : <p className="messages-selected-empty">No recipients selected</p>}
          </section>
          {selectedCount > uniquePhoneCount && selectedRecipients.every(recipient => recipient.phoneNumber) && <small>{uniquePhoneCount} unique phone number(s). Shared numbers receive one SMS.</small>}
        </div>
        <label className="messages-full">Message <em>*</em><textarea maxLength={MAX_SMS_CHARACTERS} placeholder="Type your message here..." value={form.message} onChange={event => setForm({...form,message:event.target.value})}/><small className="messages-count">{form.message.length}/{MAX_SMS_CHARACTERS} characters · {smsUsage.segments} SMS segment(s) per number · {smsUsage.segments * uniquePhoneCount} estimated total</small></label>
        <p className="messages-send-guidance messages-full">Up to {MAX_SMS_RECIPIENTS} recipients per batch, with one minute between batches. SMS usage is an estimate; IPROG headers may add credits. Delivery is confirmed separately by the provider.</p>
      </fieldset>
      <footer>{editingStatus === 'Draft' && <button type="button" className="messages-delete" disabled={sending} onClick={() => deleteMessage(messages.find(item => item.id === editingId))}><Trash2 size={16}/> Delete</button>}<button type="button" disabled={sending} onClick={() => save('Draft')}>{editingStatus === 'Draft' ? 'Save Draft' : 'Save as Draft'}</button><button type="button" className="messages-send" disabled={sending} onClick={() => save('Queued')}><Send size={16}/> {sending ? 'Sending...' : 'Send Now'}</button></footer>
    </section></div>}
  </div>
}
