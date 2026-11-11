import ActivityLogs from './pages/ActivityLogs'
import React, {useEffect,useState} from 'react'
import {apiFetch,serverAuthEnabled} from './utils/apiFetch'
import { Routes,Route,Navigate,useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import StaffDashboard from './pages/StaffDashboard'
import Records from './pages/Records'
import AddRecord from './pages/AddRecord'
import RecordDetails from './pages/RecordDetails'
import EditRecord from './pages/EditRecord'
import IdCard from './pages/IdCard'
import Reports from './pages/Reports'
import Users from './pages/Users'
import Messages from './pages/Messages'
import { getSession,setSession,clearSession } from './utils/storage'

function Protected({children,role}){
 const location=useLocation()
 const session = getSession()
 if(!session) return <Navigate to="/login" state={{from:location}} replace/>
 if(role && session.role !== role) return <Navigate to="/" replace/>
 return <Layout>{children}</Layout>
}
function RoleDashboard(){
 const role = getSession()?.role
 if(role === 'Admin') return <Dashboard/>
 if(role === 'Staff') return <StaffDashboard/>
 return <Navigate to="/login" replace/>
}
export default function App(){
 const [checking,setChecking] = useState(serverAuthEnabled)
 const [sessionError,setSessionError] = useState('')
 useEffect(() => {
   if (!serverAuthEnabled) return
   const controller = new AbortController()
   apiFetch('/api/auth/me',{signal:controller.signal}).then(async response => {
     if (response.status === 401) {clearSession();return}
     if (!response.ok) throw new Error('Could not verify your session. Reload to retry.')
     setSession(await response.json())
   }).catch(err => {if (!controller.signal.aborted) setSessionError('Could not connect to the server. Reload to retry.')})
     .finally(() => {if (!controller.signal.aborted) setChecking(false)})
   return () => controller.abort()
 },[])
 if (checking) return <p role="status">Checking session...</p>
 if (sessionError) return <p role="alert">{sessionError}</p>
 return <Routes>
   <Route path="/login" element={<Login/>}/>
   <Route path="/" element={<Protected><RoleDashboard/></Protected>}/>
   <Route path="/records" element={<Protected><Records/></Protected>}/>
   <Route path="/records/:id" element={<Protected><RecordDetails/></Protected>}/>
   <Route path="/records/:id/edit" element={<Protected role="Staff"><EditRecord/></Protected>}/>
   <Route path="/records/:id/id" element={<Protected role="Staff"><IdCard/></Protected>}/>
   <Route path="/archive" element={<Navigate to="/records?view=archived" replace/>}/>
   <Route path="/recycle-bin" element={<Navigate to="/records?view=archived" replace/>}/>
   <Route path="/add" element={<Protected role="Staff"><AddRecord/></Protected>}/>
   <Route path="/reports" element={<Protected><Reports/></Protected>}/>
   <Route path="/activity-logs" element={<Protected role="Admin"><ActivityLogs/></Protected>}/>
   <Route path="/users" element={<Protected role="Admin"><Users/></Protected>}/>
   <Route path="/messages" element={<Protected role="Staff"><Messages/></Protected>}/>
   <Route path="*" element={<Navigate to="/" replace/>}/>
 </Routes>
}
