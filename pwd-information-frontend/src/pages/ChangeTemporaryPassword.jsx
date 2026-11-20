import React,{useEffect,useRef,useState} from 'react'
import {Navigate,useNavigate} from 'react-router-dom'
import {apiFetch,serverAuthEnabled} from '../utils/apiFetch'
import {clearSession,getSession,setSession} from '../utils/storage'
import {passwordError,PASSWORD_REQUIREMENTS} from '../utils/passwordPolicy'

export default function ChangeTemporaryPassword(){
  const navigate=useNavigate()
  const session=getSession()
  const [password,setPassword]=useState('')
  const [confirmation,setConfirmation]=useState('')
  const [busy,setBusy]=useState(false)
  const [signingOut,setSigningOut]=useState(false)
  const [error,setError]=useState('')
  const [showPassword,setShowPassword]=useState(false)
  const title=useRef(null)
  const pending=busy||signingOut

  useEffect(()=>{title.current?.focus()},[])

  if(!session)return <Navigate to="/login" replace/>
  if(!serverAuthEnabled||!session.mustChangePassword)return <Navigate to="/" replace/>

  function returnToLogin(message){
    clearSession()
    navigate('/login',{replace:true,state:{message}})
  }

  async function signOut(){
    if(pending)return
    setSigningOut(true);setError('')
    try{
      const response=await apiFetch('/api/auth/logout',{method:'POST'})
      if(!response.ok&&response.status!==401)throw new Error('Could not sign out. Please try again.')
      returnToLogin('You have been signed out.')
    }catch{setError('Could not sign out. Check your connection and try again.')}
    finally{setSigningOut(false)}
  }

  async function submit(event){
    event.preventDefault()
    if(pending)return
    const invalid=passwordError(password)
    if(invalid){setError(invalid);return}
    if(password!==confirmation){setError('Passwords do not match.');return}
    setBusy(true);setError('')
    try{
      const response=await apiFetch('/api/auth/change-temporary-password',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({password}),
      })
      if(response.status===401){returnToLogin('Your session has expired. Sign in again to change your temporary password.');return}
      const result=await response.json().catch(()=>({}))
      if(!response.ok)throw new Error(result.message || 'Could not change the temporary password.')
      setSession(result)
      navigate('/',{replace:true})
    }catch(failure){setError(failure.message)}
    finally{setBusy(false)}
  }

  return <main className="temporary-password-page">
    <form className="login-card" onSubmit={submit} aria-busy={pending}>
      <h1 ref={title} tabIndex={-1}>Choose a new password</h1>
      <p>Your administrator issued a temporary password. Create a new password to continue.</p>
      <label htmlFor="temporary-new-password">New password<input id="temporary-new-password" type={showPassword?'text':'password'} autoComplete="new-password" value={password} disabled={pending} aria-describedby="temporary-password-hint" onChange={event=>setPassword(event.target.value)} required/></label>
      <small id="temporary-password-hint">{PASSWORD_REQUIREMENTS}</small>
      <label htmlFor="temporary-confirm-password">Confirm new password<input id="temporary-confirm-password" type={showPassword?'text':'password'} autoComplete="new-password" value={confirmation} disabled={pending} onChange={event=>setConfirmation(event.target.value)} required/></label>
      <label className="temporary-password-show"><input type="checkbox" checked={showPassword} disabled={pending} onChange={event=>setShowPassword(event.target.checked)}/> Show passwords</label>
      {error&&<div className="error" role="alert">{error}</div>}
      <button className="primary full" disabled={pending}>{busy?'Updating password...':'Update password'}</button>
      <button type="button" className="secondary full" disabled={pending} onClick={signOut}>{signingOut?'Signing out...':'Sign out and return to login'}</button>
    </form>
  </main>
}
