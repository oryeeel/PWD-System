import {recordStaffEvent} from '../utils/apiFetch'
import React, {useState} from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, EarOff, Brain, HeartHandshake, Speech, BrainCircuit } from 'lucide-react'
import { loadUsers, setSession } from '../utils/storage'
import { disabilityTypes } from '../utils/disabilities'

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
  'Psychosocial Disability': HeartHandshake,
  'Speech and Language Disability': Speech,
  'Learning Disability': BrainCircuit,
}
const loginDisabilityTypes = disabilityTypes.filter(type => type !== 'Multiple Disabilities')

export default function Login(){
  const nav = useNavigate()
  const [role,setRole]=useState('Admin')
  const [username,setUsername]=useState('admin')
  const [password,setPassword]=useState('admin123')
  const [showPassword,setShowPassword]=useState(false)
  const [error,setError]=useState('')

  function submit(e){
    e.preventDefault()
    const user = loadUsers().find(u => u.username===username && u.password===password && u.role===role && u.status==='Active')
    if(!user){ setError('Invalid username, password, or role.'); return }
    setSession({id:user.id, fullname:user.fullname, username:user.username, role:user.role})
    void recordStaffEvent('Signed in')
    nav('/')
  }

  return <div className="login-page">
    <div className="login-overlay">
      <section className="welcome-panel">
        <img className="big-seal office-logo" src="/mswd-logo.jpg" alt="MSWD Villanueva logo"/>
        <h1 className="login-system-title">PWD Registry and<br/>Information System</h1>
        <p className="login-office-name">Municipal Social Welfare and Development Office</p>
        <p className="login-office-location">Villanueva, Misamis Oriental</p>
        <section className="login-disabilities" aria-label="Disability types in the registry">
          <ul>{loginDisabilityTypes.map((type,index) => {
            const Icon = disabilityIcons[type]
            const [column, row] = [[3,2],[2,1],[4,1],[1,2],[5,2],[2,3],[4,3]][index]
            return <li key={type} style={{gridColumn:`${column} / span 2`,gridRow:row}}><span className="disability-symbol-tile" tabIndex={0} role="img" aria-label={type}><svg className="disability-hexagon" viewBox="0 0 86.6 100" aria-hidden="true"><polygon points="43.3,2 84.6,26 84.6,74 43.3,98 2,74 2,26"/></svg><Icon className="disability-glyph" strokeWidth={1.8} aria-hidden="true"/></span><span className="disability-symbol-caption" aria-hidden="true">{type}</span></li>
          })}</ul>
        </section>
      </section>
      <form className="login-card" onSubmit={submit}>
        <h2>Login to your account</h2>
        <p>Select your role</p>
        <div className="role-switch">
          <button type="button" className={role==='Admin'?'active':''} onClick={()=>{setRole('Admin');setUsername('admin');setPassword('admin123')}}>Admin</button>
          <button type="button" className={role==='Staff'?'active':''} onClick={()=>{setRole('Staff');setUsername('staff1');setPassword('staff123')}}>Staff</button>
        </div>
        <label>Username<input value={username} onChange={e=>setUsername(e.target.value)} required/></label>
        <label htmlFor="login-password">Password</label>
        <div className="login-password-field">
          <input id="login-password" type={showPassword ? 'text' : 'password'} value={password} onChange={e=>setPassword(e.target.value)} required/>
          <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} title={showPassword ? 'Hide password' : 'Show password'} onClick={()=>setShowPassword(value=>!value)}>{showPassword ? <Eye size={18}/> : <EyeOff size={18}/>}</button>
        </div>
        {error && <div className="error">{error}</div>}
        <button className="primary full">LOGIN</button>
      </form>
    </div>
  </div>
}
 