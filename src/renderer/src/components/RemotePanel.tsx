import { useState, useEffect, useCallback } from 'react'
import './RemotePanel.css'

const DEFAULT_RELAY_URL = 'wss://coder-relay.fly.dev'

export function RemotePanel() {
  const [relayUrl, setRelayUrl] = useState(() =>
    localStorage.getItem('relay-url') || DEFAULT_RELAY_URL
  )
  const [clerkToken, setClerkToken] = useState(() =>
    localStorage.getItem('clerk-token') || ''
  )
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected')
  const [webClients, setWebClients] = useState(0)
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    // Get initial status
    window.claude.getRemoteStatus?.().then((s) => {
      if (s) {
        setStatus(s.status)
        setWebClients(s.webClients)
      }
    })

    // Listen for status changes
    const unsub = window.claude.onRemoteStatusChange?.((s) => {
      setStatus(s.status as 'disconnected' | 'connecting' | 'connected')
      setWebClients(s.webClients)
    })
    return () => unsub?.()
  }, [])

  const handleConnect = useCallback(async () => {
    if (!relayUrl || !clerkToken) {
      setShowSettings(true)
      return
    }
    localStorage.setItem('relay-url', relayUrl)
    localStorage.setItem('clerk-token', clerkToken)
    await window.claude.connectRemote?.(relayUrl, clerkToken)
  }, [relayUrl, clerkToken])

  const handleDisconnect = useCallback(async () => {
    await window.claude.disconnectRemote?.()
  }, [])

  const isConnected = status === 'connected'
  const isConnecting = status === 'connecting'

  return (
    <div className="remote-panel">
      <div className="remote-header">
        <span className="remote-label">Remote Access</span>
        <button
          className="remote-settings-btn"
          onClick={() => setShowSettings(!showSettings)}
          title="Settings"
        >
          ...
        </button>
      </div>

      {showSettings && (
        <div className="remote-settings">
          <label>
            <span>Relay URL</span>
            <input
              type="text"
              value={relayUrl}
              onChange={(e) => setRelayUrl(e.target.value)}
              placeholder="wss://..."
              disabled={isConnected || isConnecting}
            />
          </label>
          <label>
            <span>Clerk Token</span>
            <input
              type="password"
              value={clerkToken}
              onChange={(e) => setClerkToken(e.target.value)}
              placeholder="Clerk session token"
              disabled={isConnected || isConnecting}
            />
          </label>
        </div>
      )}

      <div className="remote-controls">
        {isConnected ? (
          <>
            <div className="remote-status">
              <span className="status-dot connected" />
              <span>Connected</span>
              {webClients > 0 && (
                <span className="remote-clients">{webClients} viewer{webClients !== 1 ? 's' : ''}</span>
              )}
            </div>
            <button className="remote-btn disconnect" onClick={handleDisconnect}>
              Disconnect
            </button>
          </>
        ) : isConnecting ? (
          <div className="remote-status">
            <span className="status-dot connecting" />
            <span>Connecting...</span>
          </div>
        ) : (
          <button className="remote-btn connect" onClick={handleConnect}>
            Go Remote
          </button>
        )}
      </div>
    </div>
  )
}
