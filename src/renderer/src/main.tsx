import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthGate } from './components/AuthGate'
import { CliGate } from './components/CliGate'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      <CliGate>
        <App />
      </CliGate>
    </AuthGate>
  </StrictMode>,
)
