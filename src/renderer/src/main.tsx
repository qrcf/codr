import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthGate } from './components/AuthGate'
import { CliGate } from './components/CliGate'
import './index.css'

const App = lazy(() => import('./App.tsx'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      <CliGate>
        <Suspense fallback={null}>
          <App />
        </Suspense>
      </CliGate>
    </AuthGate>
  </StrictMode>,
)
