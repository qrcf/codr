import { useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import './CliGate.css'

interface CliGateProps {
  children: ReactNode
}

export function CliGate({ children }: CliGateProps) {
  const [cliStatus, setCliStatus] = useState<CliStatus>({ status: 'checking' })
  const [retrying, setRetrying] = useState(false)

  const checkStatus = useCallback(async () => {
    // Web client doesn't have checkCliStatus — skip the gate
    if (!window.claude.checkCliStatus) {
      setCliStatus({ status: 'ready', accountInfo: {} })
      return
    }
    setRetrying(true)
    try {
      const result = await window.claude.checkCliStatus()
      setCliStatus(result)
    } catch {
      setCliStatus({ status: 'error', message: 'Failed to check CLI status' })
    } finally {
      setRetrying(false)
    }
  }, [])

  useEffect(() => {
    checkStatus()
  }, [checkStatus])

  if (cliStatus.status === 'checking') {
    return (
      <div className="cli-gate">
        <div className="cli-loading">Checking Claude CLI...</div>
      </div>
    )
  }

  if (cliStatus.status === 'ready') {
    return <>{children}</>
  }

  return (
    <div className="cli-gate">
      <div className="cli-container">
        <h1 className="cli-title">Codr</h1>

        {cliStatus.status === 'not-installed' && (
          <>
            <p className="cli-subtitle">Claude CLI not found</p>
            <div className="cli-instructions">
              <p>Codr requires the Claude CLI to be installed.</p>
              <div className="cli-step">
                <span className="cli-step-number">1</span>
                <div>
                  <p>Install Claude Code:</p>
                  <code className="cli-code">brew install --cask claude-code</code>
                  <p className="cli-alt">
                    Or follow the{' '}
                    <a
                      href="https://code.claude.com/docs/en/quickstart"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="cli-link"
                    >
                      quickstart guide
                    </a>
                  </p>
                </div>
              </div>
              <div className="cli-step">
                <span className="cli-step-number">2</span>
                <div>
                  <p>Then log in:</p>
                  <code className="cli-code">claude login</code>
                </div>
              </div>
            </div>
          </>
        )}

        {cliStatus.status === 'not-logged-in' && (
          <>
            <p className="cli-subtitle">Not logged in to Claude CLI</p>
            <div className="cli-instructions">
              <p>Claude CLI is installed but you need to log in.</p>
              <div className="cli-step">
                <span className="cli-step-number">1</span>
                <div>
                  <p>Run this in your terminal:</p>
                  <code className="cli-code">claude login</code>
                </div>
              </div>
            </div>
          </>
        )}

        {cliStatus.status === 'error' && (
          <>
            <p className="cli-subtitle">Unable to connect to Claude CLI</p>
            <div className="cli-instructions">
              <p className="cli-error-text">{cliStatus.message}</p>
              <p>Make sure Claude CLI is installed and you are logged in:</p>
              <code className="cli-code">brew install --cask claude-code</code>
              <code className="cli-code">claude login</code>
            </div>
          </>
        )}

        <button
          className="cli-retry-btn"
          onClick={checkStatus}
          disabled={retrying}
        >
          {retrying ? 'Checking...' : 'Retry'}
        </button>
      </div>
    </div>
  )
}
