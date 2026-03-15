import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { CodrProvider } from './CodrContext'
import { AuthGate } from './components/AuthGate'
import { CliGate } from './components/CliGate'
import './index.css'

const App = lazy(() => import('./App.tsx'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CodrProvider api={window.codr}>
      <AuthGate>
        <CliGate>
          <Suspense fallback={null}>
            <App />
          </Suspense>
        </CliGate>
      </AuthGate>
    </CodrProvider>
  </StrictMode>,
)
