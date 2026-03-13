import { Download } from 'lucide-react'

export function UpdateOverlay({ version, onRestart, onDismiss }: {
  version: string
  onRestart: () => void
  onDismiss: () => void
}) {
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
      <Download size={48} style={{ color: '#8142C7', marginBottom: '8px' }} />
      <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>
        Update Ready
      </h2>
      <p style={{ margin: 0, color: '#888', fontSize: '14px', textAlign: 'center', maxWidth: '400px', lineHeight: '1.6' }}>
        Codr <span style={{ color: '#e0e0e0' }}>v{version}</span> has been downloaded
        and is ready to install. Restart to update.
      </p>
      <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
        <button
          onClick={onDismiss}
          style={{
            background: 'transparent',
            color: '#888',
            padding: '12px 32px',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 500,
            fontFamily: 'monospace',
            border: '1px solid #333',
            cursor: 'pointer',
          }}
        >
          Later
        </button>
        <button
          onClick={onRestart}
          style={{
            background: '#8142C7',
            color: '#fff',
            padding: '12px 32px',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 500,
            fontFamily: 'monospace',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Restart Now
        </button>
      </div>
    </div>
  )
}
