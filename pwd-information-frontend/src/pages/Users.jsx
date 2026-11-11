import React,{useEffect,useState} from 'react'
import {apiFetch,serverAuthEnabled} from '../utils/apiFetch'
import { loadUsers,saveUsers } from '../utils/storage'
export default function Users(){
 const [users,setUsers]=useState(loadUsers()); const [open,setOpen]=useState(false)
 const [form,setForm]=useState({username:'',fullname:'',role:'Staff',password:serverAuthEnabled ? '' : 'staff123'})
 const [error,setError]=useState('')
 const [busy,setBusy]=useState(false)
 useEffect(() => {
   if (!serverAuthEnabled) return
   const controller=new AbortController()
   apiFetch('/api/users',{signal:controller.signal}).then(async response => {
     if (!response.ok) throw new Error('Could not load users.')
     const next=await response.json()
     if (!controller.signal.aborted) {setUsers(next);sessionStorage.setItem('pwd_server_users',JSON.stringify(next))}
   }).catch(err => {if (!controller.signal.aborted) setError(err.message)})
   return () => controller.abort()
 },[])
 async function add(e){
   e.preventDefault();if(busy)return
   if(!serverAuthEnabled){const next=[...users,{...form,id:Math.max(0,...users.map(u=>u.id))+1,status:'Active'}];saveUsers(next);setUsers(next);setOpen(false);return}
   setBusy(true);setError('')
   try {
     const response=await apiFetch('/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)})
     const result=await response.json();if(!response.ok)throw new Error(result.message)
     const next=[...users,result];setUsers(next);sessionStorage.setItem('pwd_server_users',JSON.stringify(next));setOpen(false);setForm({username:'',fullname:'',role:'Staff',password:''})
   }catch(err){setError(err.message)}finally{setBusy(false)}
 }
 async function toggle(id){
   if(busy)return
   const user=users.find(u=>u.id===id);if(!user||user.role==='Admin')return
   const status=user.status==='Active'?'Archived':'Active'
   if(!serverAuthEnabled){const next=users.map(u=>u.id===id?{...u,status}:u);saveUsers(next);setUsers(next);return}
   setBusy(true);setError('')
   try {
     const response=await apiFetch(`/api/users/${encodeURIComponent(id)}/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})})
     const result=await response.json();if(!response.ok)throw new Error(result.message)
     const next=users.map(u=>u.id===id?result:u);setUsers(next);sessionStorage.setItem('pwd_server_users',JSON.stringify(next))
   }catch(err){setError(err.message)}finally{setBusy(false)}
 }
 return <>
  {error&&<p className="error" role="alert">{error}</p>}
  <div className="page-title"><div><h1>Users Management</h1><p>Manage administrator and MSWDO staff access.</p></div><button className="primary" onClick={()=>setOpen(true)}>+ Add New User</button></div>
  <div className="table-wrap"><table><thead><tr><th>Username</th><th>Full Name</th><th>Role</th><th>Status</th><th>Action</th></tr></thead><tbody>{users.map(u=><tr key={u.id}><td>{u.username}</td><td>{u.fullname}</td><td>{u.role}</td><td><span className={`badge ${u.status==='Active'?'ok':'muted'}`}>{u.status}</span></td><td>{u.role==='Admin' ? <span>Non-archivable</span> : <button className="small-btn" onClick={()=>toggle(u.id)}>{u.status==='Active'?'Archive':'Activate'}</button>}</td></tr>)}</tbody></table></div>
  {open&&<div className="modal-backdrop"><form className="modal" onSubmit={add}><div className="modal-head"><h3>Add New User</h3><button type="button" onClick={()=>setOpen(false)}>×</button></div><div className="stack"><label>Username<input value={form.username} onChange={e=>setForm({...form,username:e.target.value})} required/></label><label>Full Name<input value={form.fullname} onChange={e=>setForm({...form,fullname:e.target.value})} required/></label><label>Role<select value={form.role} onChange={e=>setForm({...form,role:e.target.value})}><option>Staff</option><option>Admin</option></select></label><label>Password<input value={form.password} onChange={e=>setForm({...form,password:e.target.value})} required/></label></div><div className="form-actions"><button type="button" className="secondary" onClick={()=>setOpen(false)}>Cancel</button><button className="primary">Create User</button></div></form></div>}
 </>
}
