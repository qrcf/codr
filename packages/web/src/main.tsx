import { StrictMode, useState, useEffect, useCallback, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  SignIn,
  useAuth,
} from '@clerk/clerk-react'
import { createWebSocketClaudeAPI } from './claude-ws-adapter'
import { ConnectionOverlay } from './connection-overlay'
import App from '@app'

// Import shared styles
import '@styles/index.css'
import '@styles/App.css'

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string
const RELAY_URL = import.meta.env.VITE_RELAY_URL as string || 'ws://localhost:8080'

if (!CLERK_PUBLISHABLE_KEY) {
  throw new Error('VITE_CLERK_PUBLISHABLE_KEY is required')
}

function ConnectedApp() {
  const { getToken } = useAuth()
  const [ready, setReady] = useState(false)
  const [desktopOnline, setDesktopOnline] = useState(false)
  const [wsConnected, setWsConnected] = useState(false)
  const apiRef = useRef<ReturnType<typeof createWebSocketClaudeAPI> | null>(null)

  const getClerkToken = useCallback(async () => {
    const token = await getToken()
    if (!token) throw new Error('No Clerk token')
    return token
  }, [getToken])

  useEffect(() => {
    const api = createWebSocketClaudeAPI(RELAY_URL, getClerkToken)
    apiRef.current = api

    // Assign to window.claude so the shared App component can use it
    ;(window as unknown as { claude: typeof api }).claude = api

    api.onDesktopStatus((online) => {
      setDesktopOnline(online)
      setWsConnected(true)
    })

    setReady(true)

    return () => {
      api.disconnect()
    }
  }, [getClerkToken])

  if (!ready) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#0d0d1a',
        color: '#888',
        fontFamily: 'monospace',
      }}>
        Loading...
      </div>
    )
  }

  return (
    <>
      <ConnectionOverlay desktopOnline={desktopOnline} wsConnected={wsConnected} />
      <App />
    </>
  )
}

function WebApp() {
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
      <SignedOut>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: '#0d0d1a',
        }}>
          <SignIn />
        </div>
      </SignedOut>
      <SignedIn>
        <ConnectedApp />
      </SignedIn>
    </ClerkProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WebApp />
  </StrictMode>,
)
