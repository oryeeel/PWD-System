import {apiFetch,recordStaffEvent,serverAuthEnabled} from '../utils/apiFetch'
import React, {useEffect,useRef,useState} from 'react'
import { useLocation,useNavigate } from 'react-router-dom'
import { Eye, EyeOff, EarOff, Brain, HeartPulse, HeartHandshake, Speech, BrainCircuit, Ribbon, Dna, Accessibility } from 'lucide-react'
import { loadUsers, setSession } from '../utils/storage'
import { disabilityTypes } from '../utils/disabilities'
import { normalizeUsername } from '../utils/accountIdentity'
import { passwordError,PASSWORD_REQUIREMENTS } from '../utils/passwordPolicy'

function WheelchairIcon(props){
  return <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="4" r="2" fill="currentColor" stroke="none"/>
    <path d="M10 8v8h7l4 6 2-1M10 11h6M7 11a6 6 0 1 0 8 9"/>
  </svg>
}

const disabilityIcons = {
  'Physical Disability': WheelchairIcon,
  'Visual Disability': EyeOff,
  'Hearing Disability': EarOff,
  'Intellectual Disability': Brain,
  'Mental Disability': HeartPulse,
  'Psychosocial Disability': HeartHandshake,
  'Cancer (RA11215)': Ribbon,
  'Rare Disease (RA10747)': Dna,
  'Speech and Language Disability': Speech,
  'Learning Disability': BrainCircuit,
}
const disabilityPositions = [[1,2],[2,1],[4,1],[3,2],[5,2],[1,3],[3,3],[5,3],[2,4],[4,4]]
const loginDisabilityTypes = disabilityTypes.filter(type => type !== 'Multiple Disabilities')

export default function Login(){
  const nav = useNavigate()
  const location = useLocation()
  const [role,setRole]=useState('Admin')
  const [username,setUsername]=useState(serverAuthEnabled ? '' : 'admin')
  const [password,setPassword]=useState(serverAuthEnabled ? '' : 'admin123')
  const [busy,setBusy]=useState(false)
  const [showPassword,setShowPassword]=useState(false)
  const [error,setError]=useState('')
  const [loginMfaRequired,setLoginMfaRequired]=useState(false)
  const [loginMfaCode,setLoginMfaCode]=useState('')
  const [loginMfaEmailHint,setLoginMfaEmailHint]=useState('')
  const [loginMfaError,setLoginMfaError]=useState('')
  const [loginMfaBusy,setLoginMfaBusy]=useState(false)
  const [loginMfaResendCooldown,setLoginMfaResendCooldown]=useState(0)
  const [recoveryOpen,setRecoveryOpen]=useState(false)
  const [recoveryStep,setRecoveryStep]=useState('email')
  const [recoveryEmail,setRecoveryEmail]=useState('')
  const [recoveryCode,setRecoveryCode]=useState('')
  const [recoveryToken,setRecoveryToken]=useState('')
  const [recoveryPassword,setRecoveryPassword]=useState('')
  const [recoveryConfirmation,setRecoveryConfirmation]=useState('')
  const [recoveryBusy,setRecoveryBusy]=useState(false)
  const [recoveryError,setRecoveryError]=useState('')
  const [recoveryMessage,setRecoveryMessage]=useState('')
  const [resendCooldown,setResendCooldown]=useState(0)
  const [showRecoveryPassword,setShowRecoveryPassword]=useState(false)
  const recoveryTitle=useRef(null)
  const recoveryButton=useRef(null)
  const hadRecoveryOpen=useRef(false)
  const [notice,setNotice]=useState(location.state?.message || '')

  useEffect(()=>{
    if(recoveryOpen){
      recoveryTitle.current?.focus()
      hadRecoveryOpen.current=true
    }else if(hadRecoveryOpen.current){
      recoveryButton.current?.focus()
    }
  },[recoveryOpen,recoveryStep])

  useEffect(()=>{
    if(!resendCooldown)return
    const timer=window.setTimeout(()=>setResendCooldown(value=>Math.max(0,value-1)),1000)
    return ()=>window.clearTimeout(timer)
  },[resendCooldown])

  useEffect(()=>{
    if(!loginMfaResendCooldown)return
    const timer=window.setTimeout(()=>setLoginMfaResendCooldown(value=>Math.max(0,value-1)),1000)
    return ()=>window.clearTimeout(timer)
  },[loginMfaResendCooldown])

  function openRecovery(){
    setError('');setRecoveryError('');setRecoveryMessage('');setRecoveryEmail('')
    setRecoveryCode('');setRecoveryToken('');setRecoveryPassword('');setRecoveryConfirmation('')
    setRecoveryStep('email');setResendCooldown(0);setShowRecoveryPassword(false);setRecoveryOpen(true)
  }

  async function requestRecoveryCode(){
    if(recoveryBusy)return
    setRecoveryBusy(true);setRecoveryError('');setRecoveryMessage('')
    try{
      const response=await apiFetch('/api/auth/password-reset/request',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({email:recoveryEmail.trim()}),
      })
      const result=await response.json().catch(()=>({}))
      if(!response.ok)throw new Error(result.message || 'Could not request a verification code.')
      setRecoveryStep('code');setRecoveryCode('');setResendCooldown(60)
      setRecoveryMessage(result.message || 'If an active account uses that email, a verification code will be sent.')
    }catch(failure){setRecoveryError(failure.message)}
    finally{setRecoveryBusy(false)}
  }

  async function verifyRecoveryCode(event){
    event.preventDefault()
    if(recoveryBusy)return
    if(!/^\d{6}$/.test(recoveryCode)){setRecoveryError('Enter the six-digit verification code.');return}
    setRecoveryBusy(true);setRecoveryError('')
    try{
      const response=await apiFetch('/api/auth/password-reset/verify',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({email:recoveryEmail.trim(),code:recoveryCode}),
      })
      const result=await response.json().catch(()=>({}))
      if(!response.ok)throw new Error(result.message || 'Could not verify the code.')
      setRecoveryToken(result.resetToken);setRecoveryStep('password');setRecoveryMessage('')
    }catch(failure){setRecoveryError(failure.message)}
    finally{setRecoveryBusy(false)}
  }

  async function completeRecovery(event){
    event.preventDefault()
    if(recoveryBusy)return
    const passwordIssue=passwordError(recoveryPassword)
    if(passwordIssue){setRecoveryError(passwordIssue);return}
    if(recoveryPassword!==recoveryConfirmation){setRecoveryError('Passwords do not match.');return}
    setRecoveryBusy(true);setRecoveryError('')
    try{
      const response=await apiFetch('/api/auth/password-reset/complete',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({resetToken:recoveryToken,password:recoveryPassword}),
      })
      const result=await response.json().catch(()=>({}))
      if(!response.ok)throw new Error(result.message || 'Could not reset the password.')
      setRecoveryOpen(false);setRecoveryToken('');setRecoveryCode('')
      setRecoveryPassword('');setRecoveryConfirmation('')
      setNotice('Your password has been reset. Sign in with your new password.')
    }catch(failure){setRecoveryError(failure.message)}
    finally{setRecoveryBusy(false)}
  }

  function closeRecovery(){
    if(recoveryBusy)return
    setRecoveryOpen(false);setRecoveryToken('');setRecoveryCode('')
    setRecoveryPassword('');setRecoveryConfirmation('');setRecoveryError('')
  }

  async function finishLogin(user){
    setSession(user)
    if(user.mustChangePassword){nav('/change-password',{replace:true});return}
    await recordStaffEvent('Signed in')
    nav('/')
  }

  async function verifyAdminCode(event){
    event.preventDefault()
    if(loginMfaBusy)return
    if(!/^\d{6}$/.test(loginMfaCode)){setLoginMfaError('Enter the six-digit verification code.');return}
    setLoginMfaBusy(true);setLoginMfaError('')
    try{
      const response=await apiFetch('/api/auth/login/verify-mfa',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({code:loginMfaCode}),
      })
      const user=await response.json().catch(()=>({}))
      if(!response.ok)throw new Error(user.message || 'Could not verify the sign-in code.')
      setLoginMfaRequired(false);setLoginMfaCode('')
      await finishLogin(user)
    }catch(failure){setLoginMfaError(failure.message)}
    finally{setLoginMfaBusy(false)}
  }

  async function resendAdminCode(){
    if(loginMfaBusy||loginMfaResendCooldown)return
    setLoginMfaBusy(true);setLoginMfaError('')
    try{
      const response=await apiFetch('/api/auth/login/resend-mfa',{method:'POST'})
      const result=await response.json().catch(()=>({}))
      if(!response.ok)throw new Error(result.message || 'Could not send another sign-in code.')
      setLoginMfaEmailHint(result.emailHint || loginMfaEmailHint)
      setLoginMfaCode('');setLoginMfaResendCooldown(60)
    }catch(failure){setLoginMfaError(failure.message)}
    finally{setLoginMfaBusy(false)}
  }

  async function cancelAdminMfa(){
    if(loginMfaBusy)return
    setLoginMfaBusy(true);setLoginMfaError('')
    try{
      const response=await apiFetch('/api/auth/login/cancel-mfa',{method:'POST'})
      if(!response.ok)throw new Error('Could not cancel sign-in verification. Please try again.')
      setLoginMfaRequired(false);setLoginMfaCode('');setLoginMfaEmailHint('')
      setLoginMfaResendCooldown(0)
    }catch(failure){setLoginMfaError(failure.message)}
    finally{setLoginMfaBusy(false)}
  }

  async function submit(e){
    e.preventDefault()
    if (busy) return
    const loginUsername = normalizeUsername(username)
    if (!loginUsername) {setError('Invalid username, password, or role.');return}
    if (serverAuthEnabled) {
      setBusy(true);setError('')
      try {
        const response = await apiFetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:loginUsername,password,role})})
        const user = await response.json().catch(()=>({}))
        if (!response.ok) throw new Error(user.message || (response.status === 429 ? 'Too many sign-in attempts. Please wait before trying again.' : 'Could not sign in.'))
        if(user.mfaRequired){
          setLoginMfaRequired(true);setLoginMfaCode('');setLoginMfaError('')
          setLoginMfaEmailHint(user.emailHint || '');setLoginMfaResendCooldown(60)
          setPassword('');return
        }
        await finishLogin(user)
      } catch(err) {setError(err.message)} finally {setBusy(false)}
      return
    }
    const user = loadUsers().find(u => normalizeUsername(u.username)===loginUsername && u.password===password && u.role===role && u.status==='Active')
    if(!user){ setError('Invalid username, password, or role.'); return }
    setSession({id:user.id, fullname:user.fullname, username:user.username, email:user.email || '', role:user.role})
    void recordStaffEvent('Signed in')
    nav('/')
  }

  return <div className="login-page">
    <div className="login-overlay">
      <section className="welcome-panel">
        <img className="big-seal office-logo" src="/mswd-logo.jpg" alt="MSWD Villanueva logo"/>
        <h1 className="login-system-title">PWD Registry and<br/>Information Management System</h1>
        <p className="login-office-name">Municipal Social Welfare and Development Office</p>
        <p className="login-office-location">Villanueva, Misamis Oriental</p>
        <section className="login-disabilities" aria-label="Disability types in the registry">
          <ul>{loginDisabilityTypes.map((type,index) => {
            const Icon = disabilityIcons[type] || Accessibility
            const [column, row] = disabilityPositions[index] || [1 + (index % 3) * 2,1 + Math.floor(index / 3)]
            return <li key={type} style={{gridColumn:`${column} / span 2`,gridRow:row}}><span className="disability-symbol-tile" tabIndex={0} role="img" aria-label={type}><svg className="disability-hexagon" viewBox="0 0 86.6 100" aria-hidden="true"><polygon points="43.3,2 84.6,26 84.6,74 43.3,98 2,74 2,26"/></svg><Icon className="disability-glyph" strokeWidth={1.8} aria-hidden="true"/></span><span className="disability-symbol-caption" aria-hidden="true">{type}</span></li>
          })}</ul>
        </section>
      </section>
      <section className="login-form-panel" aria-label={recoveryOpen ? 'Password recovery' : loginMfaRequired ? 'Admin sign-in verification' : 'Account sign in'}>
      {recoveryOpen ? <div className="login-card login-recovery">
        <h2 ref={recoveryTitle} tabIndex={-1}>{recoveryStep==='email'?'Forgot your password?':recoveryStep==='code'?'Verify your email':'Create a new password'}</h2>
        {recoveryStep==='email' && <form onSubmit={event=>{event.preventDefault();requestRecoveryCode()}}>
          <p>Enter the email address registered to your account. If an active account matches, we will send a six-digit verification code.</p>
          <label htmlFor="recovery-email">Email address<input id="recovery-email" type="email" inputMode="email" autoComplete="email" maxLength={254} value={recoveryEmail} disabled={recoveryBusy} onChange={event=>setRecoveryEmail(event.target.value)} required/></label>
          {recoveryError && <div className="error" role="alert">{recoveryError}</div>}
          <button className="primary full" disabled={recoveryBusy}>{recoveryBusy?'Sending code...':'Send verification code'}</button>
          <p className="login-recovery-help">If you cannot access your registered email, contact an administrator for account recovery.</p>
        </form>}
        {recoveryStep==='code' && <form onSubmit={verifyRecoveryCode}>
          <p>Enter the six-digit code sent to <strong>{recoveryEmail}</strong>. It expires in five minutes.</p>
          {recoveryMessage && <div className="login-notice" role="status">{recoveryMessage}</div>}
          <label htmlFor="recovery-code">Verification code<input id="recovery-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={recoveryCode} disabled={recoveryBusy} onChange={event=>setRecoveryCode(event.target.value.replace(/\D/g,'').slice(0,6))} required/></label>
          {recoveryError && <div className="error" role="alert">{recoveryError}</div>}
          <button className="primary full" disabled={recoveryBusy}>{recoveryBusy?'Verifying...':'Verify code'}</button>
          <div className="login-recovery-actions">
            <button type="button" className="link-btn" disabled={recoveryBusy||resendCooldown>0} onClick={requestRecoveryCode}>{resendCooldown>0?`Resend in ${resendCooldown}s`:'Resend code'}</button>
            <button type="button" className="link-btn" disabled={recoveryBusy} onClick={()=>{setRecoveryStep('email');setRecoveryError('');setRecoveryMessage('')}}>Use a different email</button>
          </div>
          <p className="login-recovery-help">If you cannot access this email, contact an administrator for account recovery.</p>
        </form>}
        {recoveryStep==='password' && <form onSubmit={completeRecovery}>
          <p>Your email has been verified. Choose a new password for your account.</p>
          <label htmlFor="recovery-password">New password<input id="recovery-password" type={showRecoveryPassword?'text':'password'} autoComplete="new-password" value={recoveryPassword} disabled={recoveryBusy} aria-describedby="recovery-password-hint" onChange={event=>setRecoveryPassword(event.target.value)} required/></label>
          <small id="recovery-password-hint">{PASSWORD_REQUIREMENTS}</small>
          <label htmlFor="recovery-confirmation">Confirm new password<input id="recovery-confirmation" type={showRecoveryPassword?'text':'password'} autoComplete="new-password" value={recoveryConfirmation} disabled={recoveryBusy} onChange={event=>setRecoveryConfirmation(event.target.value)} required/></label>
          <label className="login-recovery-show"><input type="checkbox" checked={showRecoveryPassword} disabled={recoveryBusy} onChange={event=>setShowRecoveryPassword(event.target.checked)}/> Show passwords</label>
          {recoveryError && <div className="error" role="alert">{recoveryError}</div>}
          <button className="primary full" disabled={recoveryBusy}>{recoveryBusy?'Resetting password...':'Reset password'}</button>
        </form>}
        <button type="button" className="secondary full login-recovery-back" disabled={recoveryBusy} onClick={closeRecovery}>Back to login</button>
      </div> : loginMfaRequired ? <div className="login-card login-recovery">
        <h2>Verify Admin sign-in</h2>
        <form onSubmit={verifyAdminCode}>
          <p>Enter the six-digit code sent to <strong>{loginMfaEmailHint}</strong>. It expires in five minutes.</p>
          <label htmlFor="admin-login-code">Verification code<input id="admin-login-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={loginMfaCode} disabled={loginMfaBusy} onChange={event=>setLoginMfaCode(event.target.value.replace(/\D/g,'').slice(0,6))} required/></label>
          {loginMfaError && <div className="error" role="alert">{loginMfaError}</div>}
          <button className="primary full" disabled={loginMfaBusy}>{loginMfaBusy?'Verifying...':'Verify and sign in'}</button>
          <div className="login-recovery-actions">
            <button type="button" className="link-btn" disabled={loginMfaBusy||loginMfaResendCooldown>0} onClick={resendAdminCode}>{loginMfaResendCooldown>0?`Resend in ${loginMfaResendCooldown}s`:'Resend code'}</button>
            <button type="button" className="link-btn" disabled={loginMfaBusy} onClick={cancelAdminMfa}>Back to login</button>
          </div>
        </form>
      </div> : <form className="login-card" onSubmit={submit}>
        <h2>Login to your account</h2>
        {notice && <div className="login-notice" role="status">{notice}</div>}
        <p>Select your role</p>
        <div className="role-switch">
          <button type="button" disabled={busy} className={role==='Admin'?'active':''} onClick={()=>{setRole('Admin');setUsername(serverAuthEnabled ? '' : 'admin');setPassword(serverAuthEnabled ? '' : 'admin123')}}>Admin</button>
          <button type="button" disabled={busy} className={role==='Staff'?'active':''} onClick={()=>{setRole('Staff');setUsername(serverAuthEnabled ? '' : 'staff1');setPassword(serverAuthEnabled ? '' : 'staff123')}}>Staff</button>
        </div>
        <label>Username<input autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={254} value={username} onChange={e=>setUsername(e.target.value)} required/></label>
        <label htmlFor="login-password">Password</label>
        <div className="login-password-field">
          <input id="login-password" autoComplete="current-password" type={showPassword ? 'text' : 'password'} value={password} onChange={e=>setPassword(e.target.value)} required/>
          <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} title={showPassword ? 'Hide password' : 'Show password'} onClick={()=>setShowPassword(value=>!value)}>{showPassword ? <Eye size={18}/> : <EyeOff size={18}/>}</button>
        </div>
        <div className="login-recovery-action"><button ref={recoveryButton} type="button" className="link-btn" disabled={busy} onClick={()=>{setPassword('');setShowPassword(false);openRecovery()}}>Forgot password?</button></div>
        {error && <div className="error" role="alert">{error}</div>}
        <button className="primary full" disabled={busy}>{busy ? 'Signing in...' : 'LOGIN'}</button>
      </form>}
      </section>
    </div>
  </div>
}

