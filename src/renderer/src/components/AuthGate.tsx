import { useState, useEffect } from 'react'
import type { ReactNode } from 'react'

const WEB_URL = import.meta.env.VITE_WEB_URL as string | undefined

interface AuthGateProps {
  children: ReactNode
}

export function AuthGate({ children }: AuthGateProps) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null) // null = checking
  const [waitingForBrowser, setWaitingForBrowser] = useState(false)

  useEffect(() => {
    // Check for existing stored token
    window.claude?.getAuthToken?.().then((token) => {
      setAuthenticated(!!token)
    })

    // Listen for token stored via deep link
    const cleanup = window.claude?.onTokenStored?.(() => {
      setAuthenticated(true)
      setWaitingForBrowser(false)
    })

    // Listen for token invalidation (401 from relay or API)
    const cleanupUnauthorized = window.claude?.onAuthUnauthorized?.(() => {
      setAuthenticated(false)
      setWaitingForBrowser(false)
    })

    return () => {
      cleanup?.()
      cleanupUnauthorized?.()
    }
  }, [])

  if (authenticated === null) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0d0d1a]">
        <div className="text-text-dim font-mono text-[14px]">Loading...</div>
      </div>
    )
  }

  if (!authenticated) {
    const handleSignIn = () => {
      if (!WEB_URL) {
        console.error('[auth] VITE_WEB_URL not configured')
        return
      }
      setWaitingForBrowser(true)
      window.claude.openAuthInBrowser?.(`${WEB_URL}?mode=electron-auth`)
    }

    return (
      <div className="flex items-center justify-center h-screen bg-[#0d0d1a]">
        <div className="flex flex-col items-center gap-4">
          <h1 className="text-[#e0e0e0] text-[32px] font-semibold m-0 font-mono">Codr</h1>
          <p className="text-[#555] font-mono text-[14px] m-0">Remote AI coding assistant</p>

          <button
            className="bg-accent border-none text-white px-12 py-3.5 rounded-lg font-mono text-[15px] font-medium cursor-pointer mt-2 transition-colors duration-150 hover:enabled:bg-[#6e35ab] disabled:bg-[#3a3560] disabled:cursor-default"
            onClick={handleSignIn}
            disabled={waitingForBrowser}
          >
            {waitingForBrowser ? 'Waiting for browser...' : 'Sign in'}
          </button>

          {waitingForBrowser && (
            <p className="text-[#555] font-mono text-[13px] m-0">
              Complete sign-in in your browser.{' '}
              <button
                className="bg-transparent border-none text-accent font-mono text-[13px] cursor-pointer p-0 underline hover:text-[#9a63d9]"
                onClick={() => setWaitingForBrowser(false)}
              >
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
