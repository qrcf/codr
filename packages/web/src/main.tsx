import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { LoadingScreen } from './LoadingScreen'

const AuthenticatedApp = lazy(() => import('./AuthenticatedApp'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<LoadingScreen />}>
      <AuthenticatedApp />
    </Suspense>
  </StrictMode>,
)
