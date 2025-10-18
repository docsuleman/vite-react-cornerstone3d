import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import TAVIApp from './components/TAVIApp.tsx'
import AuthenticatedApp from './components/AuthenticatedApp.tsx'
import { AuthProvider } from './contexts/AuthContext.tsx'
import Nifti from './Nifti.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <AuthenticatedApp />
    </AuthProvider>
    {/* <TAVIApp /> */}
    {/* <App /> */}
    {/* <Nifti /> */}
  </React.StrictMode>,
)
