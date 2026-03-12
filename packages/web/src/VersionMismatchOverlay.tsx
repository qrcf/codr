import { AlertTriangle } from 'lucide-react'

export function VersionMismatchOverlay({ desktopVersion, webVersion }: { desktopVersion: string; webVersion: string }) {
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
      <AlertTriangle size={48} style={{ color: '#f0c040', marginBottom: '8px' }} />
      <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>
        Version Mismatch
      </h2>
      <p style={{ margin: 0, color: '#888', fontSize: '14px', textAlign: 'center', maxWidth: '400px', lineHeight: '1.6' }}>
        Your desktop app (<span style={{ color: '#e0e0e0' }}>v{desktopVersion}</span>) is out of date
        with the web client (<span style={{ color: '#e0e0e0' }}>v{webVersion}</span>).
        Please download the latest version to continue.
      </p>
      <a
        href="https://codr.works"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'inline-block',
          marginTop: '8px',
          background: '#8142C7',
          color: '#fff',
          padding: '12px 32px',
          borderRadius: '8px',
          fontSize: '14px',
          fontWeight: 500,
          fontFamily: 'monospace',
          textDecoration: 'none',
          cursor: 'pointer',
        }}
      >
        Download Latest Version
      </a>
      <p style={{ margin: 0, color: '#555', fontSize: '12px', marginTop: '4px' }}>
        codr.works
      </p>
    </div>
  )
}
