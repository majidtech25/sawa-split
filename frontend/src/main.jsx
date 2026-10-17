import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Installable app (SCOPE_V2 MUST 20). Production only: in development a cached app
// would hide changes. The worker never handles the API or Supabase (public/sw.js).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // No service worker: the site works exactly the same, just not installable.
    })
  })
}
