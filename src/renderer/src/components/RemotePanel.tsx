import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '@clerk/clerk-react'
import './RemotePanel.css'

const RELAY_URL = import.meta.env.VITE_RELAY_URL || 'wss://coder-ai.fly.dev'

export function RemotePanel() {
  const { getToken } = useAuth()
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected')
  const [webClients, setWebClients] = useState(0)
  const tokenRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const connectedRef = useRef(false)

  const connect = useCallback(async () => {
    try {
      const token = await getToken()
      if (!token) return
      await window.claude.connectRemote?.(RELAY_URL, token)
      connectedRef.current = true
    } catch (err) {
      console.error('[remote] Failed to connect:', err)
    }
  }, [getToken])

  // Auto-connect on mount, refresh token periodically
  useEffect(() => {
    connect()

    // Clerk JWTs are short-lived — refresh every 50s
    tokenRefreshRef.current = setInterval(async () => {
      if (!connectedRef.current) return
      try {
        const token = await getToken()
        if (token) {
          await window.claude.connectRemote?.(RELAY_URL, token)
        }
      } catch {
        // Token refresh failed — relay will reconnect on its own
      }
    }, 50_000)

    return () => {
      if (tokenRefreshRef.current) {
        clearInterval(tokenRefreshRef.current)
      }
      connectedRef.current = false
      window.claude.disconnectRemote?.()
    }
  }, [connect, getToken])

  // Listen for status changes
  useEffect(() => {
    window.claude.getRemoteStatus?.().then((s) => {
      if (s) {
        setStatus(s.status)
        setWebClients(s.webClients)
      }
    })

    const unsub = window.claude.onRemoteStatusChange?.((s) => {
      setStatus(s.status as 'disconnected' | 'connecting' | 'connected')
      setWebClients(s.webClients)
    })
    return () => unsub?.()
  }, [])

  return (
    <div className="remote-panel">
      <div className="remote-status">
        <span className={`status-dot ${status}`} />
        <span className="remote-status-text">
          {status === 'connected' && 'Remote'}
          {status === 'connecting' && 'Connecting...'}
          {status === 'disconnected' && 'Offline'}
        </span>
        {status === 'connected' && webClients > 0 && (
          <span className="remote-clients">
            {webClients} viewer{webClients !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </div>
  )
}
