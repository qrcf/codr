import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  SignIn,
  useAuth,
  useSignIn,
} from '@clerk/clerk-react'
import { createWebSocketClaudeAPI } from './claude-ws-adapter'
import { ConnectionOverlay } from './ConnectionOverlay'
import { VersionMismatchOverlay } from './VersionMismatchOverlay'

declare const __APP_VERSION__: string
import App from '@app'

// Import shared styles
import '@styles/index.css'

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string
const RELAY_URL = import.meta.env.VITE_RELAY_URL as string || 'ws://localhost:8080'
const API_URL = import.meta.env.VITE_API_URL as string || 'http://localhost:3001'

if (!CLERK_PUBLISHABLE_KEY) {
  throw new Error('VITE_CLERK_PUBLISHABLE_KEY is required')
}

// No-op stub so window.agent/window.claude are never undefined when shared components mount.
// The real WebSocket-backed implementation replaces this in ConnectedApp's useEffect.
function createStubAgentAPI() {
  const noopUnsub = () => () => {}
  return {
    query: async () => {},
    interrupt: async () => {},
    getAgentState: async () => ({
      isLoading: false,
      streamingText: '',
      streamingThinking: '',
      streamingTools: [] as unknown[],
    }),
    onMessage: noopUnsub,
    onError: noopUnsub,
    onDone: noopUnsub,
    onPermissionRequest: noopUnsub,
    respondPermission: () => {},
    onQuestionRequest: noopUnsub,
    respondQuestion: () => {},
    updateSettings: () => {},
    selectFolder: async () => null as string | null,
    listSessions: async () => ({ sessions: [] as unknown[], titlesLoaded: false }),
    getSessionMessages: async () => [] as unknown[],
    getAccountInfo: async () => null,
    onAccountInfoUpdate: noopUnsub,
    listFiles: async () => [] as string[],
    onSessionRefreshHint: noopUnsub,
    onSessionUpdated: noopUnsub,
    getRemoteStatus: async () => null,
    onRemoteStatusChange: noopUnsub,
    onStateSync: noopUnsub,
    onDesktopStatus: noopUnsub,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isElectron = !!(window as any).claude?.isElectron

// Only install the stub if the preload script hasn't already provided window.claude
if (!isElectron) {
  const stub = createStubAgentAPI()
  ;(window as unknown as { claude: ReturnType<typeof createStubAgentAPI>; agent: ReturnType<typeof createStubAgentAPI> }).claude = stub
  ;(window as unknown as { claude: ReturnType<typeof createStubAgentAPI>; agent: ReturnType<typeof createStubAgentAPI> }).agent = stub
}

function ConnectedApp() {
  // If running inside the Electron shell, the preload script already provides
  // window.claude via IPC — no need for the WebSocket adapter
  if (isElectron) {
    return <App />
  }

  const { getToken, signOut } = useAuth()
  const [ready, setReady] = useState(false)
  const [desktopOnline, setDesktopOnline] = useState<boolean | null>(null)
  const [desktopVersion, setDesktopVersion] = useState<string | null>(null)
  const apiRef = useRef<ReturnType<typeof createWebSocketClaudeAPI> | null>(null)

  const getClerkToken = useCallback(async () => {
    const token = await getToken()
    if (!token) throw new Error('No Clerk token')
    return token
  }, [getToken])

  useEffect(() => {
    const api = createWebSocketClaudeAPI(RELAY_URL, getClerkToken)
    apiRef.current = api

    // Keep both names during migration.
    ;(window as unknown as { claude: typeof api; agent: typeof api }).claude = api
    ;(window as unknown as { claude: typeof api; agent: typeof api }).agent = api

    const unsubDesktop = api.onDesktopStatus((online) => setDesktopOnline(online))
    const unsubVersion = api.onDesktopVersion((version) => setDesktopVersion(version))
    const unsubAuthFailed = api.onAuthFailed(() => { void signOut() })

    setReady(true)

    return () => {
      unsubDesktop()
      unsubVersion()
      unsubAuthFailed()
      api.disconnect()
      const stub = createStubAgentAPI()
      ;(window as unknown as { claude: ReturnType<typeof createStubAgentAPI>; agent: ReturnType<typeof createStubAgentAPI> }).claude = stub
      ;(window as unknown as { claude: ReturnType<typeof createStubAgentAPI>; agent: ReturnType<typeof createStubAgentAPI> }).agent = stub
    }
  }, [getClerkToken, signOut])

  // Show version mismatch overlay in production when desktop version doesn't match web version
  const webVersion = __APP_VERSION__
  const showVersionMismatch = import.meta.env.PROD
    && desktopOnline === true
    && desktopVersion !== null
    && desktopVersion !== webVersion

  if (!ready || desktopOnline !== true) {
    // Show ConnectionOverlay until desktop is confirmed online.
    // This covers: initial load, relay connecting, and desktop explicitly offline.
    return showVersionMismatch
      ? <VersionMismatchOverlay desktopVersion={desktopVersion!} webVersion={webVersion} />
      : <ConnectionOverlay />
  }

  return (
    <>
      {showVersionMismatch && <VersionMismatchOverlay desktopVersion={desktopVersion!} webVersion={webVersion} />}
      <App />
    </>
  )
}

const isElectronAuth = new URLSearchParams(window.location.search).get('mode') === 'electron-auth'

// Sign-in UI for the Electron shell — opens system browser instead of inline Clerk form
function ElectronSignIn() {
  const { signIn, setActive, isLoaded } = useSignIn()
  const [waitingForBrowser, setWaitingForBrowser] = useState(false)

  useEffect(() => {
    if (!isLoaded) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claude = (window as any).claude
    const cleanup = claude.onAuthToken?.(async (token: string) => {
      try {
        const result = await signIn!.create({ strategy: 'ticket', ticket: token })
        if (result.status === 'complete' && result.createdSessionId) {
          await setActive!({ session: result.createdSessionId })
        }
      } catch (err) {
        console.error('[auth] Ticket sign-in failed:', err)
        setWaitingForBrowser(false)
      }
    })
    return () => cleanup?.()
  }, [signIn, setActive, isLoaded])

  const handleSignIn = () => {
    setWaitingForBrowser(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).claude.openAuthInBrowser?.(`${window.location.origin}?mode=electron-auth`)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0d0d1a' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
        <h1 style={{ color: '#e0e0e0', fontSize: '32px', fontWeight: 600, margin: 0, fontFamily: 'monospace' }}>Codr</h1>
        <p style={{ color: '#555', fontFamily: 'monospace', fontSize: '14px', margin: 0 }}>Remote AI coding assistant</p>
        <button
          onClick={handleSignIn}
          disabled={waitingForBrowser}
          style={{
            background: waitingForBrowser ? '#3a3560' : '#8142C7',
            border: 'none',
            color: '#fff',
            padding: '14px 48px',
            borderRadius: '8px',
            fontFamily: 'monospace',
            fontSize: '15px',
            fontWeight: 500,
            cursor: waitingForBrowser ? 'default' : 'pointer',
            marginTop: '8px',
          }}
        >
          {waitingForBrowser ? 'Waiting for browser...' : 'Sign in'}
        </button>
        {waitingForBrowser && (
          <p style={{ color: '#555', fontFamily: 'monospace', fontSize: '13px', margin: 0 }}>
            Complete sign-in in your browser.{' '}
            <button
              onClick={() => setWaitingForBrowser(false)}
              style={{ background: 'none', border: 'none', color: '#8142C7', fontFamily: 'monospace', fontSize: '13px', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
            >
              Cancel
            </button>
          </p>
        )}
      </div>
    </div>
  )
}

function ElectronAuthCallback() {
  const { getToken } = useAuth()
  const [status, setStatus] = useState<'loading' | 'redirecting' | 'done' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function exchangeToken() {
      try {
        const jwt = await getToken()
        if (!jwt || cancelled) return

        const res = await fetch(`${API_URL}/auth/desktop-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: jwt }),
        })

        if (!res.ok) throw new Error(`Server error: ${res.status}`)

        const data = await res.json()
        if (cancelled) return

        setStatus('redirecting')
        window.location.href = `codr://auth/callback?token=${data.token}`

        setTimeout(() => {
          if (!cancelled) setStatus('done')
        }, 2000)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error')
          setStatus('error')
        }
      }
    }

    exchangeToken()
    return () => { cancelled = true }
  }, [getToken])

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background: '#0d0d1a',
      color: '#e0e0e0',
      fontFamily: 'monospace',
      gap: '16px',
    }}>
      {status === 'loading' && <p>Signing you in...</p>}
      {status === 'redirecting' && <p>Redirecting to Codr...</p>}
      {status === 'done' && (
        <>
          <p style={{ fontSize: '18px' }}>You can close this tab</p>
          <p style={{ color: '#888' }}>Sign-in was sent to the Codr app</p>
        </>
      )}
      {status === 'error' && (
        <>
          <p style={{ color: '#ff6b6b' }}>Sign-in failed</p>
          <p style={{ color: '#888', fontSize: '14px' }}>{error}</p>
        </>
      )}
    </div>
  )
}

export default function AuthenticatedApp() {
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
      <SignedOut>
        {isElectron ? (
          <ElectronSignIn />
        ) : (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            background: '#0d0d1a',
          }}>
            <SignIn />
          </div>
        )}
      </SignedOut>
      <SignedIn>
        {isElectronAuth ? <ElectronAuthCallback /> : <ConnectedApp />}
      </SignedIn>
    </ClerkProvider>
  )
}
