import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import MarketingPage from './marketing/MarketingPage'
import PrivacyPolicy from './marketing/PrivacyPolicy'
import TermsOfService from './marketing/TermsOfService'

const AuthenticatedApp = lazy(() => import('./AuthenticatedApp'))

const pathname = window.location.pathname
const isAppRoute = pathname.startsWith('/app')
const isElectronAuth = new URLSearchParams(window.location.search).get('mode') === 'electron-auth'
const isPrivacy = pathname === '/privacy'
const isTerms = pathname === '/terms'

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

function getPage() {
  if (isAppRoute || isElectronAuth) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <AuthenticatedApp />
      </Suspense>
    )
  }
  if (isPrivacy) return <PrivacyPolicy />
  if (isTerms) return <TermsOfService />
  return <MarketingPage />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {getPage()}
  </StrictMode>,
)
