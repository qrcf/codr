import { useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { useCodr } from '../hooks/useCodr'

interface CliGateProps {
  children: ReactNode
}

export function CliGate({ children }: CliGateProps) {
  const codr = useCodr()
  const [cliStatus, setCliStatus] = useState<CliStatus>({ status: 'checking' })
  const [retrying, setRetrying] = useState(false)

  const checkStatus = useCallback(async () => {
    // Web client doesn't have checkCliStatus — skip the gate
    if (!codr.checkCliStatus) {
      setCliStatus({ status: 'ready', accountInfo: {} })
      return
    }
    setRetrying(true)
    try {
      const result = await codr.checkCliStatus()
      setCliStatus(result)
    } catch {
      setCliStatus({ status: 'error', message: 'Failed to check CLI status' })
    } finally {
      setRetrying(false)
    }
  }, [codr])

  useEffect(() => {
    checkStatus()
  }, [checkStatus])

  if (cliStatus.status === 'checking') {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0d0d1a]">
        <div className="text-text-dim font-mono text-[14px]">Checking Claude CLI...</div>
      </div>
    )
  }

  if (cliStatus.status === 'ready') {
    return <>{children}</>
  }

  return (
    <div className="flex items-center justify-center h-screen bg-[#0d0d1a]">
      <div className="flex flex-col items-center gap-4 max-w-120 px-6">
        <h1 className="text-[#e0e0e0] text-[32px] font-semibold m-0 font-mono">Codr</h1>

        {cliStatus.status === 'not-installed' && (
          <>
            <p className="text-[#e08050] font-mono text-[16px] m-0 font-medium">Claude CLI not found</p>
            <div className="text-text-muted font-mono text-[13px] text-left w-full">
              <p className="my-1">Codr requires the Claude CLI to be installed.</p>
              <div className="flex gap-3 my-3 items-start">
                <span className="bg-accent text-white w-6 h-6 rounded-full flex items-center justify-center text-[12px] shrink-0">1</span>
                <div>
                  <p className="my-1">Install Claude Code:</p>
                  <code className="block bg-[#1a1a2e] border border-[#2a2a4a] rounded-md px-3 py-2 text-[#a0d0a0] text-[13px] mt-1 select-all">brew install --cask claude-code</code>
                  <p className="text-text-dim text-[12px] mt-2 mb-1">
                    Or follow the{' '}
                    <a
                      href="https://code.claude.com/docs/en/quickstart"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent underline hover:text-[#9a63d9]"
                    >
                      quickstart guide
                    </a>
                  </p>
                </div>
              </div>
              <div className="flex gap-3 my-3 items-start">
                <span className="bg-accent text-white w-6 h-6 rounded-full flex items-center justify-center text-[12px] shrink-0">2</span>
                <div>
                  <p className="my-1">Then log in:</p>
                  <code className="block bg-[#1a1a2e] border border-[#2a2a4a] rounded-md px-3 py-2 text-[#a0d0a0] text-[13px] mt-1 select-all">claude login</code>
                </div>
              </div>
            </div>
          </>
        )}

        {cliStatus.status === 'not-logged-in' && (
          <>
            <p className="text-[#e08050] font-mono text-[16px] m-0 font-medium">Not logged in to Claude CLI</p>
            <div className="text-text-muted font-mono text-[13px] text-left w-full">
              <p className="my-1">Claude CLI is installed but you need to log in.</p>
              <div className="flex gap-3 my-3 items-start">
                <span className="bg-accent text-white w-6 h-6 rounded-full flex items-center justify-center text-[12px] shrink-0">1</span>
                <div>
                  <p className="my-1">Run this in your terminal:</p>
                  <code className="block bg-[#1a1a2e] border border-[#2a2a4a] rounded-md px-3 py-2 text-[#a0d0a0] text-[13px] mt-1 select-all">claude login</code>
                </div>
              </div>
            </div>
          </>
        )}

        {cliStatus.status === 'error' && (
          <>
            <p className="text-[#e08050] font-mono text-[16px] m-0 font-medium">Unable to connect to Claude CLI</p>
            <div className="text-text-muted font-mono text-[13px] text-left w-full">
              <p className="text-[#d09090] bg-[#1a1a2e] border border-[#4a2a2a] rounded-md px-3 py-2 text-[12px] wrap-break-word">{cliStatus.message}</p>
              <p className="my-1">Make sure Claude CLI is installed and you are logged in:</p>
              <code className="block bg-[#1a1a2e] border border-[#2a2a4a] rounded-md px-3 py-2 text-[#a0d0a0] text-[13px] mt-1 select-all">brew install --cask claude-code</code>
              <code className="block bg-[#1a1a2e] border border-[#2a2a4a] rounded-md px-3 py-2 text-[#a0d0a0] text-[13px] mt-1 select-all">claude login</code>
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
