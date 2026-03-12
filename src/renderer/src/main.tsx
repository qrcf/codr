import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import { AuthGate } from './components/AuthGate'
import { CliGate } from './components/CliGate'
import './index.css'
import App from './App.tsx'

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string

if (!CLERK_PUBLISHABLE_KEY) {
  throw new Error('VITE_CLERK_PUBLISHABLE_KEY is required. Add it to .env at the project root.')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
      <AuthGate>
        <CliGate>
          <App />
        </CliGate>
      </AuthGate>
    </ClerkProvider>
  </StrictMode>,
)
