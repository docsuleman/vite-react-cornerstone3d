import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import TAVIApp from './components/TAVIApp.tsx'
import Nifti from './Nifti.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TAVIApp />
    {/* <App /> */}
    {/* <Nifti /> */}
  </React.StrictMode>,
)
