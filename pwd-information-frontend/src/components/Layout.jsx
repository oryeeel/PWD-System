import {apiFetch,recordStaffEvent,serverAuthEnabled} from '../utils/apiFetch'
import {userDisplayName} from '../utils/userDisplayName'
import React, {useEffect,useRef,useState} from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Accessibility, UserPlus, FileBarChart, Users, MessageSquare, LogOut, CalendarDays, UserCircle, Menu, X, ClipboardList } from 'lucide-react'
import { clearSession, getSession } from '../utils/storage'

const items = [
  ['/', 'Dashboard', LayoutDashboard],
  ['/records', 'PWD Records', Accessibility],
  ['/add', 'Add New Record', UserPlus],
  ['/reports', 'Reports', FileBarChart],
  ['/messages', 'Messages', MessageSquare],
  ['/users', 'Users', Users],
  ['/activity-logs', 'Activity Logs', ClipboardList],
]

export default function Layout({children}) {
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen,setMenuOpen] = useState(false)
  const logoutDialog = useRef(null)
  const user = getSession()
  const [logoutError,setLogoutError] = useState('')
  const [loggingOut,setLoggingOut] = useState(false)
  async function logout() {
    if (loggingOut) return
    setLoggingOut(true);setLogoutError('')
    try {
      await recordStaffEvent('Signed out')
      if (serverAuthEnabled) {
        const response = await apiFetch('/api/auth/logout',{method:'POST'})
        if (!response.ok) throw new Error('Could not sign out. Please try again.')
      }
      logoutDialog.current.close();clearSession();navigate('/login',{replace:true})
    } catch(err) {setLogoutError(err.message)} finally {setLoggingOut(false)}
  }
  const visibleItems = user?.role === 'Staff' ? items.filter(i => i[0] !== '/users' && i[0] !== '/activity-logs').map(i => i[0] === '/messages' ? [i[0], 'Send a Message', i[2]] : i) : items.filter(i => i[0] !== '/messages' && i[0] !== '/add')

  useEffect(() => setMenuOpen(false),[location.pathname])

  return (
    <div className={`app-shell ${menuOpen ? 'menu-open' : ''}`}>
      <header className="topbar">
        <button type="button" className="mobile-menu-button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-controls="primary-navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={21}/> : <Menu size={21}/>}</button>
        <div className="header-brand"><img className="seal office-logo" src="/mswd-logo.jpg" alt="MSWD Villanueva logo"/><div><strong title="PWD Registry and Information Management System">PWD Registry and Information Management System</strong><div className="header-brand-details"><small className="office-subtitle">MSWDO | Villanueva, Misamis Oriental</small></div></div></div>
        <div className="top-actions">
          <span className="header-date"><CalendarDays size={17}/>{new Date().toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'})}</span>
          <span className="header-user"><UserCircle size={20}/>{user?.role === 'Staff' ? userDisplayName(user) : user?.fullname || 'Admin'}</span>
          <button type="button" className="icon-btn" title="Logout" aria-label="Log out" onClick={() => logoutDialog.current.showModal()}><LogOut size={18}/></button>
        </div>
      </header>
      {menuOpen && <button type="button" className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)}/>}
      <aside className="sidebar">
        <nav id="primary-navigation" aria-label="Main navigation">
          {visibleItems.map(([to,label,Icon]) => (
            <NavLink key={to} to={to} end={to==='/'} title={label} aria-label={label}>
              <Icon size={18}/><span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="main">
        <div className="content">{children}</div>
      </main>
      <dialog ref={logoutDialog} className="logout-dialog" aria-labelledby="logout-title" aria-describedby="logout-question">
        <h2 id="logout-title">Log Out</h2>
        <p id="logout-question">Are you sure you want to log out?</p>
        {logoutError && <p role="alert">{logoutError}</p>}
        <div>
          <button type="button" className="secondary" autoFocus onClick={() => logoutDialog.current.close()}>No, Stay Signed In</button>
          <button type="button" className="primary" disabled={loggingOut} onClick={logout}>Yes, Log Out</button>
        </div>
      </dialog>
    </div>
  )
}
