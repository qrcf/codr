import { useAuth, useSignIn } from '@clerk/clerk-react'
import { useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import './AuthGate.css'

const WEB_URL = import.meta.env.VITE_WEB_URL as string | undefined

interface AuthGateProps {
  children: ReactNode
}

export function AuthGate({ children }: AuthGateProps) {
  const { isSignedIn, isLoaded } = useAuth()
  const { signIn, setActive, isLoaded: signInLoaded } = useSignIn()
  const [waitingForBrowser, setWaitingForBrowser] = useState(false)

  // Listen for sign-in token from deep link (codr://auth/callback?token=...)
  useEffect(() => {
    if (!signInLoaded) return

    const cleanup = window.claude.onAuthToken?.(async (token: string) => {
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
  }, [signIn, setActive, signInLoaded])

  if (!isLoaded) {
    return (
      <div className="auth-gate">
        <div className="auth-loading">Loading...</div>
      </div>
    )
  }

  if (!isSignedIn) {
    const handleSignIn = () => {
      if (!WEB_URL) {
        console.error('[auth] VITE_WEB_URL not configured')
        return
      }
      setWaitingForBrowser(true)
      window.claude.openAuthInBrowser?.(`${WEB_URL}?mode=electron-auth`)
    }

    return (
      <div className="auth-gate">
        <div className="auth-container">
          <h1 className="auth-title">Codr</h1>
          <p className="auth-subtitle">Remote AI coding assistant</p>

          <button
            className="auth-sign-in-btn"
            onClick={handleSignIn}
            disabled={waitingForBrowser}
          >
            {waitingForBrowser ? 'Waiting for browser...' : 'Sign in'}
          </button>

          {waitingForBrowser && (
            <p className="auth-hint">
              Complete sign-in in your browser.{' '}
              <button className="auth-cancel" onClick={() => setWaitingForBrowser(false)}>
                Cancel
              </button>
            </p>
          )}
        </div>
      </div>
    )
  }

  return <>{children}</>
}
