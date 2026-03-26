import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  SignIn,
  useAuth,
  useSignIn,
} from '@clerk/clerk-react'
import { createWebSocketCodrAPI } from './ws-adapter'
import { CodrProvider } from '@codr-context'
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isElectron = !!(window as any).codr?.isElectron

function WebConnectedApp() {
  const { getToken, signOut } = useAuth()
  const [desktopOnline, setDesktopOnline] = useState<boolean | null>(null)
  const [desktopVersion, setDesktopVersion] = useState<string | null>(null)
  const [api, setApi] = useState<ReturnType<typeof createWebSocketCodrAPI> | null>(null)
  const apiRef = useRef<ReturnType<typeof createWebSocketCodrAPI> | null>(null)

  const getClerkToken = useCallback(async () => {
    const token = await getToken()
    if (!token) throw new Error('No Clerk token')
    return token
  }, [getToken])

  useEffect(() => {
    const wsApi = createWebSocketCodrAPI(RELAY_URL, getClerkToken)
    apiRef.current = wsApi

    const unsubDesktop = wsApi.onDesktopStatus((online) => setDesktopOnline(online))
    const unsubVersion = wsApi.onDesktopVersion((version) => setDesktopVersion(version))
    const unsubAuthFailed = wsApi.onAuthFailed(() => { void signOut() })

    // Defer setState to avoid synchronous setState-in-effect
    queueMicrotask(() => setApi(wsApi))

    return () => {
      unsubDesktop()
      unsubVersion()
      unsubAuthFailed()
      wsApi.disconnect()
      apiRef.current = null
      setApi(null)
    }
  }, [getClerkToken, signOut])

  // Show version mismatch overlay in production when desktop version doesn't match web version
  const webVersion = __APP_VERSION__
  const showVersionMismatch = import.meta.env.PROD
    && desktopOnline === true
    && desktopVersion !== null
    && desktopVersion !== webVersion

  if (!api || desktopOnline !== true) {
    return showVersionMismatch
      ? <VersionMismatchOverlay desktopVersion={desktopVersion!} webVersion={webVersion} />
      : <ConnectionOverlay />
  }

  return (
    <CodrProvider api={api as unknown as CodrAPI}>
      {showVersionMismatch && <VersionMismatchOverlay desktopVersion={desktopVersion!} webVersion={webVersion} />}
      <App />
    </CodrProvider>
  )
}

function ConnectedApp() {
  // If running inside the Electron shell, the preload script already provides
  // window.codr via IPC — CodrProvider wraps the tree in main.tsx
  return isElectron ? <App /> : <WebConnectedApp />
}

// Persist electron-auth mode in sessionStorage so it survives Clerk OAuth redirects
// (e.g., Google/GitHub sign-in navigates away and back, losing URL params)
const params = new URLSearchParams(window.location.search)
if (params.get('mode') === 'electron-auth') {
  sessionStorage.setItem('electron-auth', '1')
}
const isElectronAuth = params.get('mode') === 'electron-auth' || sessionStorage.getItem('electron-auth') === '1'

// Sign-in UI for the Electron shell — opens system browser instead of inline Clerk form
function ElectronSignIn() {
  const { signIn, setActive, isLoaded } = useSignIn()
  const [waitingForBrowser, setWaitingForBrowser] = useState(false)

  useEffect(() => {
    if (!isLoaded) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claude = (window as any).codr
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
    ;(window as any).codr.openAuthInBrowser?.(`${window.location.origin}?mode=electron-auth`)
  }

  return (
    <div className="flex items-center justify-center h-screen bg-[#0d0d1a]">
      <div className="flex flex-col items-center gap-4">
        <h1 className="text-[#e0e0e0] text-[32px] font-semibold m-0 font-mono">Codr</h1>
        <p className="text-text-dim font-mono text-sm m-0">Remote AI coding assistant</p>
        <button
          onClick={handleSignIn}
          disabled={waitingForBrowser}
          className="bg-accent disabled:bg-accent-disabled border-none text-white px-12 py-3.5 rounded-lg font-mono text-[15px] font-medium cursor-pointer disabled:cursor-default mt-2"
        >
          {waitingForBrowser ? 'Waiting for browser...' : 'Sign in'}
        </button>
        {waitingForBrowser && (
          <p className="text-text-dim font-mono text-[13px] m-0">
            Complete sign-in in your browser.{' '}
            <button
              onClick={() => setWaitingForBrowser(false)}
              className="bg-transparent border-none text-accent font-mono text-[13px] cursor-pointer p-0 underline"
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

        // Clean up sessionStorage now that token exchange is done
        sessionStorage.removeItem('electron-auth')

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
    <div className="flex flex-col items-center justify-center h-screen bg-[#0d0d1a] text-[#e0e0e0] font-mono gap-4">
      {status === 'loading' && <p>Signing you in...</p>}
      {status === 'redirecting' && <p>Redirecting to Codr...</p>}
      {status === 'done' && (
        <>
          <p className="text-[18px]">You can close this tab</p>
          <p className="text-text-faint">Sign-in was sent to the Codr app</p>
        </>
      )}
      {status === 'error' && (
        <>
          <p className="text-[#ff6b6b]">Sign-in failed</p>
          <p className="text-text-faint text-sm">{error}</p>
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
          <div className="flex items-center justify-center h-screen bg-[#0d0d1a]">
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
