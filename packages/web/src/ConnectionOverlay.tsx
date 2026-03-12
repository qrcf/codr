import { Monitor } from 'lucide-react'

export function ConnectionOverlay() {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0d0d1a',
      color: '#e0e0e0',
      fontFamily: 'monospace',
      gap: '16px',
    }}>
      <Monitor size={48} style={{ color: '#555', marginBottom: '8px' }} />
      <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>
        Desktop App Not Connected
      </h2>
      <p style={{ margin: 0, color: '#888', fontSize: '14px', textAlign: 'center', maxWidth: '360px', lineHeight: '1.6' }}>
        The Codr desktop app must be running and connected for web access to work.
      </p>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginTop: '8px',
        color: '#555',
        fontSize: '13px',
      }}>
        <div style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: '#f0c040',
          animation: 'pulse-dot 1.5s ease-in-out infinite',
        }} />
        Waiting for desktop app...
      </div>
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  )
}
