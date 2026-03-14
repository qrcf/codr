import { useState, useEffect } from 'react'
import { Sparkles, Terminal, Database } from 'lucide-react'
import { DocsPanel } from './DocsPanel'
import type { DocsAPI } from './DocsPanel'
import { LabPanel } from './LabPanel'

interface SettingsPanelProps {
  onClose: () => void
  docsAPI?: DocsAPI
  userProfile?: { email: string | null; fullName: string | null; imageUrl: string | null } | null
  onAddDocSource?: (url: string, name: string, crawlDepth?: number, prefix?: string) => Promise<void>
  onRecrawlDocSource?: (sourceId: number, url: string, crawlDepth: number, prefix?: string) => Promise<void>
}

type Tab = 'general' | 'docs' | 'lab'

function IndexerStatusSection() {
  const [status, setStatus] = useState<{ status: string; detail?: string }>({ status: 'not-ready' })
  const [progress, setProgress] = useState<{ step: string; detail?: string } | null>(null)
  const [reinstalling, setReinstalling] = useState(false)

  useEffect(() => {
    window.claude.getIndexerStatus?.().then(setStatus).catch(() => {})
    const unsub = window.claude.onIndexerSetupProgress?.((p: { step: string; detail?: string; projectDir?: string }) => {
      if (p.projectDir) return // ignore project-specific events
      setProgress(p)
      if (p.step === 'ready' || p.step === 'error') {
        window.claude.getIndexerStatus?.().then(setStatus).catch(() => {})
      }
    })
    return () => { unsub?.() }
  }, [])

  const statusBadge = (() => {
    switch (status.status) {
      case 'ready':
        return <span className="px-2 py-0.5 rounded text-[11px] bg-[#1a2e1a] text-[#50c878]">Ready</span>
      case 'setting-up':
        return <span className="px-2 py-0.5 rounded text-[11px] bg-[#2e2a1a] text-[#d4a845] animate-pulse">Setting up</span>
      case 'error':
        return <span className="px-2 py-0.5 rounded text-[11px] bg-[#2e1a1a] text-[#e06060]">Error</span>
      default:
        return <span className="px-2 py-0.5 rounded text-[11px] bg-[#222] text-[#666]">Not installed</span>
    }
  })()

  const statusText = (() => {
    if (progress && status.status === 'setting-up') {
      return progress.detail || progress.step
    }
    if (status.status === 'error') {
      return status.detail || 'Setup failed'
    }
    return null
  })()

  return (
    <section className="mb-8">
      <h3 className="m-0 mb-3 text-[13px] font-semibold text-[#888] uppercase tracking-[0.05em]">Indexer</h3>
      <div className="bg-[#1a1a2a] border border-[#2a2a3a] rounded-lg p-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2.5">
            <Database size={16} className="text-[#888] shrink-0" />
            <span className="text-[14px] text-[#e0e0e0] font-medium">Project Indexer</span>
          </div>
          {statusBadge}
        </div>
        {statusText && (
          <div className="text-[12px] text-[#888] mb-3 ml-[26px]">{statusText}</div>
        )}
        {(status.status === 'error' || status.status === 'ready') && (
          <div className="flex gap-2 ml-[26px]">
            <button
              className="bg-transparent border border-[#333] text-[#888] py-1.5 px-3 rounded-md text-[12px] cursor-pointer transition-colors duration-150 hover:bg-[#2a2a3a] hover:text-[#ccc] disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => {
                setReinstalling(true)
                window.claude.reinstallIndexer?.()
                  .then(() => window.claude.getIndexerStatus?.().then(setStatus).catch(() => {}))
                  .finally(() => setReinstalling(false))
              }}
              disabled={reinstalling || (status.status as string) === 'setting-up'}
            >
              {reinstalling ? 'Reinstalling...' : 'Reinstall'}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

export function SettingsPanel({ onClose, docsAPI, userProfile, onAddDocSource, onRecrawlDocSource }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('general')
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null)
  const [providerStatus, setProviderStatus] = useState<{
    claude: { installed: boolean; loggedIn: boolean; detail?: string; email?: string; org?: string }
    codex: { installed: boolean; loggedIn: boolean; detail?: string; email?: string; org?: string }
  } | null>(null)
  // Fetch account info with retry — probe query may fail in packaged builds
  useEffect(() => {
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false
    let attempts = 0
    const MAX_ATTEMPTS = 6

    const fetchAccountInfo = () => {
      window.claude.getAccountInfo().then((result) => {
        if (cancelled) return
        if (result && typeof result === 'object' && 'error' in result) {
          console.error('[account-info]', (result as { error: string }).error)
          if (attempts < MAX_ATTEMPTS) {
            attempts++
            retryTimer = setTimeout(fetchAccountInfo, 5000)
          }
          return
        }
        if (result) {
          setAccountInfo(result)
        } else if (attempts < MAX_ATTEMPTS) {
          attempts++
          retryTimer = setTimeout(fetchAccountInfo, 5000)
        }
      }).catch((err) => {
        if (cancelled) return
        console.error('[account-info] IPC error:', err)
        if (attempts < MAX_ATTEMPTS) {
          attempts++
          retryTimer = setTimeout(fetchAccountInfo, 5000)
        }
      })
    }

    fetchAccountInfo()

    const unsubAccountInfo = window.claude.onAccountInfoUpdate?.((info: AccountInfo) => {
      if (info) setAccountInfo(info)
    })

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      unsubAccountInfo?.()
    }
  }, [])

  // Fetch independent provider status for both Claude and Codex
  useEffect(() => {
    window.claude.getProviderStatus?.().then((status) => {
      if (status) setProviderStatus(status)
    }).catch(() => {})
  }, [])

  const tabBtnClass = (isActive: boolean) =>
    `bg-transparent border-0 border-b-2 px-5 py-3.5 text-[14px] cursor-pointer transition-colors duration-150 ${
      isActive
        ? 'text-[#e0e0e0] border-b-[#8142c7]'
        : 'text-[#888] border-b-transparent hover:text-[#ccc]'
    } max-[768px]:px-3 max-[768px]:py-3 max-[768px]:text-[13px]`

  const sectionTitleClass = 'm-0 mb-3 text-[13px] font-semibold text-[#888] uppercase tracking-[0.05em]'

  return (
    <div className="flex flex-col flex-1 h-screen min-w-0 bg-[#121218]">
      {/* Topbar */}
      <div className="flex items-center justify-between px-4 border-b border-[#2a2a3a] shrink-0">
        <div className="flex gap-0">
          <button className={tabBtnClass(activeTab === 'general')} onClick={() => setActiveTab('general')}>General</button>
          <button className={tabBtnClass(activeTab === 'docs')} onClick={() => setActiveTab('docs')}>Docs</button>
          {import.meta.env.DEV && (
            <button className={tabBtnClass(activeTab === 'lab')} onClick={() => setActiveTab('lab')}>Lab</button>
          )}
        </div>
        <button
          className="bg-transparent border border-[#333] text-[#888] w-8 h-8 rounded-md cursor-pointer flex items-center justify-center text-[16px] transition-colors duration-150 shrink-0 hover:bg-[#2a2a3a] hover:text-[#ccc]"
          onClick={onClose}
          title="Close settings"
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 px-8 py-6 overflow-y-auto text-[#bbb] text-[14px] max-[768px]:px-4">
        {activeTab === 'general' && (
          <div>
            {/* Account section */}
            <section className="mb-8">
              <h3 className={sectionTitleClass}>Account</h3>
              <div className="flex items-center justify-between gap-3 bg-[#1a1a2a] border border-[#2a2a3a] rounded-lg p-4 max-[768px]:flex-col max-[768px]:items-start max-[768px]:gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  {userProfile?.imageUrl && (
                    <img
                      className="w-10 h-10 rounded-full object-cover shrink-0 border border-[#333]"
                      src={userProfile.imageUrl}
                      alt={userProfile.fullName || 'User avatar'}
                      referrerPolicy="no-referrer"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    {userProfile?.fullName && (
                      <div className="text-[#e0e0e0] text-[15px] font-medium mb-0.5 overflow-hidden text-ellipsis whitespace-nowrap">{userProfile.fullName}</div>
                    )}
                    <div className="text-[#999] text-[13px] mb-2 overflow-hidden text-ellipsis whitespace-nowrap">
                      {userProfile?.email || accountInfo?.email || 'Loading...'}
                    </div>
                    {providerStatus && (
                      <div className="flex gap-1.5 flex-wrap">
                        {providerStatus.claude.installed && (
                          <span className={`px-2 py-0.5 rounded text-[11px] ${
                            providerStatus.claude.loggedIn
                              ? 'bg-[#2d1f3d] text-[#b89de0]'
                              : 'bg-[#2a2835] text-[#9a7fc0]'
                          }`}>
                            {providerStatus.claude.loggedIn
                              ? (providerStatus.claude.detail || 'Claude')
                              : 'Claude · not logged in'}
                          </span>
                        )}
                        {providerStatus.codex.installed && (
                          <span className={`px-2 py-0.5 rounded text-[11px] ${
                            providerStatus.codex.loggedIn
                              ? 'bg-[#192d28] text-[#7ecfbd]'
                              : 'bg-[#1e2a2a] text-[#6aab9c]'
                          }`}>
                            {providerStatus.codex.loggedIn
                              ? (providerStatus.codex.detail && providerStatus.codex.detail !== 'Ready' ? `Codex · ${providerStatus.codex.detail}` : 'Codex')
                              : 'Codex · not logged in'}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  className="bg-transparent border border-[#333] text-[#888] py-2 px-4 rounded-md text-[13px] cursor-pointer transition-colors duration-150 shrink-0 hover:bg-[#2a2a3a] hover:text-[#ccc]"
                  onClick={() => { window.claude.disconnectRemote?.(); window.claude.signOut?.().then(() => window.location.reload()) }}
                >
                  Sign out
                </button>
              </div>
            </section>

            {/* Provider cards */}
            <section className="mb-8">
              <h3 className={sectionTitleClass}>Agent Provider</h3>
              <div className="flex gap-3">
                {(['claude', 'codex'] as const).map((id) => {
                  const status = providerStatus?.[id]
                  return (
                    <div
                      key={id}
                      className="flex-1 border border-[#2a2a3a] rounded-[10px] px-4 py-3.5 bg-[#1a1a2a] flex flex-col gap-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${id === 'claude' ? 'bg-[rgba(129,66,199,0.15)] text-[#b89de0]' : 'bg-[rgba(106,171,156,0.15)] text-[#7ecfbd]'}`}>
                          {id === 'claude' ? <Sparkles size={18} /> : <Terminal size={18} />}
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                          <span className="text-[15px] font-semibold text-[#e0e0e0]">{id === 'claude' ? 'Claude' : 'Codex'}</span>
                          {status?.detail && <span className="text-[12px] text-[#777]">{status.detail}</span>}
                        </div>
                      </div>
                      {status && (
                        <div className="flex flex-col gap-2.5 border-t border-[#2a2a3a] pt-2.5">
                          {(status.email || status.org) && (
                            <div className="flex flex-col gap-px">
                              {status.email && <span className="text-[12px] text-[#bbb] font-medium">{status.email}</span>}
                              {status.org && <span className="text-[11px] text-[#666]">{status.org}</span>}
                            </div>
                          )}
                          <div className="flex items-center gap-2 text-[12px]">
                            <span className={status.installed ? 'text-[#50c878]' : 'text-[#666]'}>
                              {status.installed ? 'Installed' : 'Not installed'}
                            </span>
                            <span className="w-[3px] h-[3px] rounded-full bg-[#444] shrink-0" />
                            <span className={status.loggedIn ? 'text-[#50c878]' : 'text-[#666]'}>
                              {status.loggedIn ? 'Authenticated' : 'Not logged in'}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>

            {/* Indexer section */}
            <IndexerStatusSection />
          </div>
        )}

        {activeTab === 'docs' && (
          <DocsPanel
            docsAPI={docsAPI}
            onAddDocSource={onAddDocSource}
            onRecrawlDocSource={onRecrawlDocSource}
          />
        )}

        {activeTab === 'lab' && import.meta.env.DEV && <LabPanel />}
      </div>
    </div>
  )
}
