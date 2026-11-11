import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles.css'
import './dashboard.css'
import './records.css'
import './record-details.css'
import './id-view.css'
import './add-record.css'
import './reports.css'
import './palette.css'
import './modern-theme.css'
import './record-workspace.css'
import './login.css'
import './sidebar.css'

localStorage.removeItem('pwd_theme_v1')
document.documentElement.removeAttribute('data-theme')
document.documentElement.style.colorScheme = 'light'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
