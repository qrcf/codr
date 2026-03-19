import { useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { useCodr } from '../../hooks/useCodr'

interface CliGateProps {
  children: ReactNode
}

type GateStatus = 'checking' | 'ready' | 'no-providers' | 'error'

export function CliGate({ children }: CliGateProps) {
  const codr = useCodr()
  const [gateStatus, setGateStatus] = useState<GateStatus>('checking')
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [retrying, setRetrying] = useState(false)

  const checkStatus = useCallback(async () => {
    // Web client doesn't have provider status checking — skip the gate
    if (!codr.getProviderStatus && !codr.checkCliStatus) {
      setGateStatus('ready')
      return
    }

    setRetrying(true)
    try {
      // Try multi-provider status first
      if (codr.getProviderStatus) {
        const status = await codr.getProviderStatus()
        const anyReady = Object.values(status).some(
          s => s.installed && s.loggedIn
        )
        const anyInstalled = Object.values(status).some(s => s.installed)

        if (anyReady) {
          setGateStatus('ready')
          return
        }

        if (anyInstalled) {
          // At least one provider is installed but none are logged in
          setGateStatus('no-providers')
          setErrorMessage('Providers are installed but none are logged in. Please log in to at least one provider.')
          return
        }

        setGateStatus('no-providers')
        return
      }

      // Fallback to legacy Claude-only check
      if (codr.checkCliStatus) {
        const result = await codr.checkCliStatus()
        if (result.status === 'ready') {
          setGateStatus('ready')
        } else if (result.status === 'error') {
          setGateStatus('error')
          setErrorMessage(result.message)
        } else {
          setGateStatus('no-providers')
        }
      }
    } catch {
      setGateStatus('error')
      setErrorMessage('Failed to check provider status')
    } finally {
      setRetrying(false)
    }
  }, [codr])

  useEffect(() => {
    checkStatus()
  }, [checkStatus])

  // React to background status refresh results
  useEffect(() => {
    if (!codr.onProviderStatusChanged) return
    return codr.onProviderStatusChanged((status) => {
      const anyReady = Object.values(status).some(s => s.installed && s.loggedIn)
      if (anyReady) setGateStatus('ready')
    })
  }, [codr])

  if (gateStatus === 'checking') {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0d0d1a]">
        <div className="text-text-dim font-mono text-[14px]">Checking providers...</div>
      </div>
    )
  }

  if (gateStatus === 'ready') {
    return <>{children}</>
  }

  return (
    <div className="flex items-center justify-center h-screen bg-[#0d0d1a]">
      <div className="flex flex-col items-center gap-4 max-w-120 px-6">
        <h1 className="text-[#e0e0e0] text-[32px] font-semibold m-0 font-mono">Codr</h1>

        {gateStatus === 'no-providers' && (
          <>
            <p className="text-[#e08050] font-mono text-[16px] m-0 font-medium">No providers configured</p>
            <div className="text-text-muted font-mono text-[13px] text-left w-full">
              <p className="my-1">Codr needs at least one AI provider to be installed and logged in.</p>

              <div className="mt-4 mb-2 text-[#aaa] font-semibold text-[14px]">Option 1: Claude Code</div>
              <div className="flex gap-3 my-3 items-start">
                <span className="bg-accent text-white w-6 h-6 rounded-full flex items-center justify-center text-[12px] shrink-0">1</span>
                <div>
                  <p className="my-1">Install Claude Code:</p>
                  <code className="block bg-[#1a1a2e] border border-[#2a2a4a] rounded-md px-3 py-2 text-[#a0d0a0] text-[13px] mt-1 select-all">brew install --cask claude-code</code>
                </div>
              </div>
              <div className="flex gap-3 my-3 items-start">
                <span className="bg-accent text-white w-6 h-6 rounded-full flex items-center justify-center text-[12px] shrink-0">2</span>
                <div>
                  <p className="my-1">Then log in:</p>
                  <code className="block bg-[#1a1a2e] border border-[#2a2a4a] rounded-md px-3 py-2 text-[#a0d0a0] text-[13px] mt-1 select-all">claude login</code>
                </div>
              </div>

              <div className="mt-4 mb-2 text-[#aaa] font-semibold text-[14px]">Option 2: Cursor Agent</div>
              <div className="flex gap-3 my-3 items-start">
                <span className="bg-[#1a3a5a] text-white w-6 h-6 rounded-full flex items-center justify-center text-[12px] shrink-0">1</span>
                <div>
                  <p className="my-1">Install Cursor and log in:</p>
                  <code className="block bg-[#1a1a2e] border border-[#2a2a4a] rounded-md px-3 py-2 text-[#a0d0a0] text-[13px] mt-1 select-all">cursor agent login</code>
                </div>
              </div>
            </div>
          </>
        )}

        {gateStatus === 'error' && (
          <>
            <p className="text-[#e08050] font-mono text-[16px] m-0 font-medium">Unable to check provider status</p>
            <div className="text-text-muted font-mono text-[13px] text-left w-full">
              <p className="text-[#d09090] bg-[#1a1a2e] border border-[#4a2a2a] rounded-md px-3 py-2 text-[12px] wrap-break-word">{errorMessage}</p>
              <p className="my-1">Make sure at least one provider CLI is installed and you are logged in.</p>
            </div>
          </>
        )}

        <button
          className="bg-accent border-none text-white px-12 py-3.5 rounded-lg font-mono text-[15px] font-medium cursor-pointer mt-2 transition-colors duration-150 hover:enabled:bg-accent-hover disabled:bg-accent-disabled disabled:cursor-default"
          onClick={checkStatus}
          disabled={retrying}
        >
          {retrying ? 'Checking...' : 'Retry'}
        </button>
      </div>
    </div>
  )
}
