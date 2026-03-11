import { useState, useEffect } from 'react'

interface ConnectionOverlayProps {
  desktopOnline: boolean
  wsConnected: boolean
}

export function ConnectionOverlay({ desktopOnline, wsConnected }: ConnectionOverlayProps) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    if (desktopOnline && wsConnected) {
      // Fade out after a moment when connected
      const timer = setTimeout(() => setVisible(false), 1500)
      return () => clearTimeout(timer)
    }
    setVisible(true)
  }, [desktopOnline, wsConnected])

  if (!visible) return null

  let message: string
  let color: string

  if (!wsConnected) {
    message = 'Connecting to relay...'
    color = '#f0c040'
  } else if (!desktopOnline) {
    message = 'Desktop app is offline'
    color = '#f44336'
  } else {
    message = 'Connected'
    color = '#4caf50'
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 12,
        right: 12,
        padding: '8px 16px',
        borderRadius: 8,
        background: '#1e1e2e',
        border: `1px solid ${color}`,
        color,
        fontSize: 13,
        fontFamily: 'monospace',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color,
          display: 'inline-block',
        }}
      />
      {message}
    </div>
  )
}
