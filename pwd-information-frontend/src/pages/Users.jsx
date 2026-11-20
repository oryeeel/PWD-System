import React,{useEffect,useRef,useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {apiFetch,serverAuthEnabled} from '../utils/apiFetch'
import {loadUsers,saveUsers,getSession,setSession,clearSession} from '../utils/storage'
import {normalizeEmail,normalizeUsername} from '../utils/accountIdentity'
import {passwordError,PASSWORD_REQUIREMENTS} from '../utils/passwordPolicy'
import '../users.css'

const emptyForm = role => ({username:'',fullname:'',email:'',role,password:'',confirmation:''})

export default function Users() {
  const navigate = useNavigate()
  const [users,setUsers] = useState(loadUsers)
  const [open,setOpen] = useState(false)
  const [form,setForm] = useState(() => emptyForm('Staff'))
  const [error,setError] = useState('')
  const [busy,setBusy] = useState(false)
  const [editingId,setEditingId] = useState(null)
  const [showPassword,setShowPassword] = useState(false)
  const [resetUser,setResetUser] = useState(null)
  const [identityConfirmed,setIdentityConfirmed] = useState(false)
  const [temporaryPassword,setTemporaryPassword] = useState('')
  const [success,setSuccess] = useState('')
  const userDialog = useRef(null)
  const resetDialog = useRef(null)
  const temporaryPasswordTitle = useRef(null)
  const editing = editingId !== null
  const canEditPassword = !editing || form.role === 'Admin'
  const passwordFeedback = form.password ? passwordError(form.password) : ''
  const passwordValid = Boolean(form.password) && !passwordFeedback

  function startAdd() {
    setSuccess('');setShowPassword(false);setEditingId(null)
    setForm(emptyForm('Staff'));setError('');setOpen(true)
  }
  function startEdit(user) {
    setSuccess('');setShowPassword(false);setEditingId(user.id)
    setForm({...emptyForm(user.role),username:user.username,fullname:user.fullname,email:user.email || ''})
    setError('');setOpen(true)
  }
  function closeUser() {
    if (busy) return
    setOpen(false);setForm(emptyForm('Staff'));setError('');setShowPassword(false)
  }
  function startReset(user) {
    setSuccess('');setError('');setShowPassword(false)
    setIdentityConfirmed(false);setTemporaryPassword('');setResetUser(user)
  }
  function closeReset() {
    if (busy) return
    setResetUser(null);setIdentityConfirmed(false);setTemporaryPassword('');setError('');setShowPassword(false)
  }
  function updateCurrentUser(user,passwordChanged=false) {
    if (String(getSession()?.id) !== String(user.id)) return
    if (passwordChanged) {
      clearSession()
      navigate('/login',{replace:true,state:{message:'Your password has been changed. Sign in with your new password.'}})
      return
    }
    setSession({id:user.id,username:user.username,fullname:user.fullname,email:user.email || '',role:user.role})
  }
  useEffect(() => {
    if (!open && !resetUser) return
    const previousFocus = document.activeElement
    const dialog = open ? userDialog.current : resetDialog.current
    dialog?.querySelector('input')?.focus()
    return () => previousFocus?.focus()
  },[open,resetUser])

  useEffect(() => {
    if (temporaryPassword) temporaryPasswordTitle.current?.focus()
  },[temporaryPassword])

  function handleDialogKeyDown(event,ref,close) {
    if (event.key === 'Escape') {event.preventDefault();close();return}
    if (event.key !== 'Tab') return
    const elements = [...ref.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')]
    if (!elements.length) {event.preventDefault();return}
    const first = elements[0],last = elements[elements.length - 1]
    if (event.shiftKey && document.activeElement === first) {event.preventDefault();last?.focus()}
    else if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first?.focus()}
  }
  useEffect(() => {
    if (!serverAuthEnabled) return
    const controller = new AbortController()
    apiFetch('/api/users',{signal:controller.signal}).then(async response => {
      if (!response.ok) throw new Error('Could not load users.')
      const next = await response.json()
      if (!controller.signal.aborted) {setUsers(next);sessionStorage.setItem('pwd_server_users',JSON.stringify(next))}
    }).catch(err => {if (!controller.signal.aborted) setError(err.message)})
    return () => controller.abort()
  },[])

  async function add(event) {
    event.preventDefault()
    if (busy) return
    setError('')
    const emailInput = form.email.trim()
    const email = normalizeEmail(form.email)
    const username = normalizeUsername(form.username)
    const passwordChanged = canEditPassword && Boolean(form.password)
    if (!username) {setError('Use a valid email address, or a username of 3-50 letters, numbers, dots, underscores, or hyphens.');return}
    if (!form.fullname.trim() || form.fullname.length > 150) {setError('Enter a full name of up to 150 characters.');return}
    if ((!editing && !email) || (emailInput && !email)) {setError('Enter a valid email address.');return}
    if (!['Admin','Staff'].includes(form.role)) {setError('Choose Admin or Staff.');return}
    if (canEditPassword && (!editing || passwordChanged)) {
      const passwordIssue = passwordError(form.password)
      if (passwordIssue) {setError(passwordIssue);return}
    }
    if (canEditPassword && form.password !== form.confirmation) {setError('Passwords do not match.');return}
    const account = {username,fullname:form.fullname.trim(),...(email ? {email} : {}),role:form.role,...(passwordChanged ? {password:form.password} : {})}
    setBusy(true)
    try {
      let result
      if (serverAuthEnabled) {
        const response = await apiFetch(editing ? `/api/users/${encodeURIComponent(editingId)}` : '/api/users',{
          method:editing ? 'PATCH' : 'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(account),
        })
        result = await response.json()
        if (!response.ok) throw new Error(result.message || 'Could not save the account.')
      } else {
        if (users.some(user => user.id !== editingId && normalizeUsername(user.username) === account.username)) throw new Error('Username already exists.')
        if (email && users.some(user => user.id !== editingId && normalizeEmail(user.email) === email)) throw new Error('Email address already belongs to another account.')
        result = editing
          ? {...users.find(user => user.id === editingId),...account}
          : {...account,id:Math.max(0,...users.map(user => Number(user.id) || 0)) + 1,status:'Active'}
      }
      const next = editing ? users.map(user => user.id === editingId ? result : user) : [...users,result]
      if (serverAuthEnabled) sessionStorage.setItem('pwd_server_users',JSON.stringify(next))
      else saveUsers(next)
      setUsers(next)
      setSuccess(editing
        ? `Account updated for ${result.fullname}.`
        : `${result.role} account created for ${result.fullname}.`)
      if (editing) updateCurrentUser(result,passwordChanged)
      setOpen(false);setForm(emptyForm('Staff'));setShowPassword(false)
    } catch (failure) {setError(failure.message)}
    finally {setBusy(false)}
  }

  async function resetPassword(event) {
    event.preventDefault()
    if (busy || !resetUser) return
    setError('')
    if (!identityConfirmed) {setError("Confirm that you verified the account owner's identity.");return}
    if (!serverAuthEnabled) {setError('Temporary password resets require server authentication.');return}
    setBusy(true)
    try {
      const response = await apiFetch(`/api/users/${encodeURIComponent(resetUser.id)}/temporary-password`,{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identityVerified:true}),
      })
      if (!(response.headers.get('content-type') || '').includes('application/json')) {
        const backendHint = import.meta.env.DEV
          ? 'Restart the localhost backend with SERVER_AUTH=true.'
          : 'Check that VITE_API_URL points to the deployed backend.'
        throw new Error(response.status === 404
          ? `The password reset endpoint was not found. ${backendHint}`
          : `The API returned a web page instead of JSON. ${backendHint}`)
      }
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Could not reset the password.')
      const next = users.map(user => user.id === resetUser.id ? result.user : user)
      sessionStorage.setItem('pwd_server_users',JSON.stringify(next))
      setUsers(next)
      setTemporaryPassword(result.temporaryPassword)
      setIdentityConfirmed(false)
      setSuccess(`Temporary password generated for ${result.user.username}.`)
    } catch (failure) {setError(failure.message)}
    finally {setBusy(false)}
  }

  async function toggle(id) {
    if (busy) return
    const user = users.find(user => user.id === id)
    if (!user || user.role === 'Admin') return
    const status = user.status === 'Active' ? 'Archived' : 'Active'
    if (!serverAuthEnabled) {
      const next = users.map(user => user.id === id ? {...user,status} : user)
      saveUsers(next);setUsers(next);return
    }
    setBusy(true);setError('')
    try {
      const response = await apiFetch(`/api/users/${encodeURIComponent(id)}/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})})
      const result = await response.json()
      if (!response.ok) throw new Error(result.message)
      const next = users.map(user => user.id === id ? result : user)
      setUsers(next);sessionStorage.setItem('pwd_server_users',JSON.stringify(next))
    } catch (failure) {setError(failure.message)}
    finally {setBusy(false)}
  }

  return <div className="users-page">
    {error && !open && !resetUser && <p className="error" role="alert">{error}</p>}
    {success && <p className="info-box users-success" role="status">{success}</p>}
    <div className="page-title">
      <div><h1>Users Management</h1><p>Manage administrator and MSWDO staff access.</p></div>
      <div className="users-create-actions">
        <button type="button" className="primary" disabled={busy} onClick={startAdd}>Create account</button>
      </div>
    </div>
    <p className="users-guidance">Choose Admin or Staff when creating an account. Each account needs its own email address.</p>
    {!serverAuthEnabled && <p className="users-demo-note">Demo accounts are saved only in this browser.</p>}
    <div className="table-wrap"><table><thead><tr><th>Username</th><th>Full Name</th><th>Email</th><th>Role</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>{users.map(user => <tr key={user.id}>
        <td>{user.username}</td><td>{user.fullname}</td><td className="users-email">{user.email || <span className="users-no-email">Not added</span>}</td><td>{user.role}</td>
        <td><span className={`badge ${user.status === 'Active' ? 'ok' : 'muted'}`}>{user.status}</span></td>
        <td><div className="users-row-actions">
          <button type="button" className="small-btn" disabled={busy} onClick={() => startEdit(user)}>Edit</button>
          {serverAuthEnabled && user.role === 'Staff' && user.status === 'Active' && <button type="button" className="small-btn" disabled={busy} onClick={() => startReset(user)}>Reset Password</button>}
          {user.role === 'Admin' ? <span>Non-archivable</span> : <button type="button" className="small-btn" disabled={busy} onClick={() => toggle(user.id)}>{user.status === 'Active' ? 'Archive' : 'Activate'}</button>}
        </div></td>
      </tr>)}</tbody>
    </table></div>

    {resetUser && <div className="modal-backdrop"><form ref={resetDialog} className="modal users-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-password-title" aria-describedby="reset-password-description" aria-busy={busy} onSubmit={resetPassword} onKeyDown={event => handleDialogKeyDown(event,resetDialog,closeReset)}>
      <div className="modal-head"><h3 id="reset-password-title">Reset Password</h3><button type="button" disabled={busy} aria-label="Close password reset" onClick={closeReset}>&times;</button></div>
      <p id="reset-password-description">After verifying the identity of <strong>{resetUser.fullname}</strong> ({resetUser.username}), generate a temporary password. Their existing sessions will be signed out and they must choose a new password at next sign-in.</p>
      {temporaryPassword ? <div className="users-temporary-password">
        <strong ref={temporaryPasswordTitle} tabIndex={-1}>Temporary password — share privately</strong>
        <code tabIndex={0}>{temporaryPassword}</code>
        <p>This password is shown only once. It is not saved in the account list.</p>
        <div className="form-actions"><button type="button" className="primary" onClick={closeReset}>Done</button></div>
      </div> : <div className="stack">
        {error && <p className="error" role="alert">{error}</p>}
        <label className="users-identity-confirmation"><input type="checkbox" checked={identityConfirmed} disabled={busy} onChange={event => setIdentityConfirmed(event.target.checked)} required/> I verified this account owner's identity.</label>
        <div className="form-actions"><button type="button" className="secondary" disabled={busy} onClick={closeReset}>Cancel</button><button className="primary" disabled={busy||!identityConfirmed}>{busy ? 'Generating...' : 'Generate temporary password'}</button></div>
      </div>}
    </form></div>}

    {open && <div className="modal-backdrop"><form ref={userDialog} className="modal users-dialog" role="dialog" aria-modal="true" aria-labelledby="user-dialog-title" aria-describedby="user-dialog-description" aria-busy={busy} onSubmit={add} onKeyDown={event => handleDialogKeyDown(event,userDialog,closeUser)}>
      <div className="modal-head"><h3 id="user-dialog-title">{editing ? 'Edit User' : `Create ${form.role} Account`}</h3><button type="button" disabled={busy} aria-label="Close account form" onClick={closeUser}>&times;</button></div>
      <p id="user-dialog-description">{editing ? 'Keep the account details and email address up to date.' : 'Enter the account owner\'s details and choose a password.'}</p>
      <div className="stack">
        {error && <p className="error" role="alert">{error}</p>}
        <label htmlFor="user-fullname">Full name<input id="user-fullname" name="fullname" autoComplete="name" maxLength={150} value={form.fullname} disabled={busy} onChange={event => setForm({...form,fullname:event.target.value})} required/></label>
        <label htmlFor="user-email">Email address<input id="user-email" name="email" type="email" inputMode="email" autoComplete="email" maxLength={254} value={form.email} disabled={busy} onChange={event => setForm({...form,email:event.target.value})} onBlur={() => setForm(previous => ({...previous,email:normalizeEmail(previous.email) || previous.email}))} aria-describedby="user-email-hint" required={!editing}/></label>
        <small id="user-email-hint">Use an email address that belongs to this account owner. Each email can be used for one account.</small>
        <label htmlFor="user-username">Username<input id="user-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={254} value={form.username} disabled={busy} onChange={event => setForm({...form,username:event.target.value})} onBlur={() => setForm(previous => ({...previous,username:normalizeUsername(previous.username) || previous.username}))} aria-describedby="user-username-hint" required/></label>
        <small id="user-username-hint">Use an email address, or 3-50 letters, numbers, dots, underscores, or hyphens. Sign in using this username.</small>
        <label htmlFor="user-role">Role<select id="user-role" name="role" disabled={busy || editing} value={form.role} onChange={event => setForm({...form,role:event.target.value})}><option>Admin</option><option>Staff</option></select></label>
        {canEditPassword ? <><label htmlFor="user-password">{editing ? 'New password (leave blank to keep current)' : 'Password'}
          <span className="users-password-row">
            <input id="user-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={form.password} disabled={busy} onChange={event => setForm({...form,password:event.target.value})} aria-describedby="user-password-hint" required={!editing}/>
            <button type="button" className="secondary" disabled={busy} aria-controls="user-password user-password-confirmation" aria-label={showPassword ? 'Hide passwords' : 'Show passwords'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? 'Hide' : 'Show'}</button>
          </span>
        </label>
        <small id="user-password-hint" className={passwordFeedback ? 'users-password-warning' : passwordValid ? 'users-password-valid' : ''} aria-live="polite">
          {passwordFeedback || (passwordValid ? 'Password meets all requirements.' : PASSWORD_REQUIREMENTS)}
        </small>
        <label htmlFor="user-password-confirmation">{editing ? 'Confirm new password' : 'Confirm password'}<input id="user-password-confirmation" name="confirmation" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={form.confirmation} disabled={busy} onChange={event => setForm({...form,confirmation:event.target.value})} required={!editing || Boolean(form.password)}/></label></> : <p className="users-guidance">To reset this staff member's password, close this form and choose <strong>Reset Password</strong> after verifying their identity.</p>}
      </div>
      <div className="form-actions"><button type="button" className="secondary" disabled={busy} onClick={closeUser}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving...' : editing ? 'Save Changes' : `Create ${form.role}`}</button></div>
    </form></div>}
  </div>
}
