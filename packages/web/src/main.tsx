import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'

const AuthenticatedApp = lazy(() => import('./AuthenticatedApp'))

function LoadingScreen() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background: '#0d0d1a',
      color: '#888',
      fontFamily: 'monospace',
    }}>
      Loading...
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<LoadingScreen />}>
      <AuthenticatedApp />
    </Suspense>
  </StrictMode>,
)
