import { useState, useEffect } from 'react'
import { Database } from 'lucide-react'
import { PROVIDER_THEME } from '../../provider-config'
import { ProviderLogo } from '../ui/ProviderLogo'
import { DocsPanel } from './DocsPanel'
import type { DocsAPI } from './DocsPanel'
import { LabPanel } from './LabPanel'
import { useCodr } from '../../hooks/useCodr'


interface SettingsPanelProps {
  onClose: () => void
  docsAPI?: DocsAPI
  userProfile?: { email: string | null; fullName: string | null; imageUrl: string | null } | null
  onAddDocSource?: (url: string, name: string, crawlDepth?: number, prefix?: string) => Promise<void>
  onRecrawlDocSource?: (sourceId: number, name: string, url: string, crawlDepth: number, prefix?: string) => Promise<void>
}

type Tab = 'general' | 'docs' | 'files' | 'lab'

function IndexerStatusSection() {
  const codr = useCodr()
  const [status, setStatus] = useState<{ status: string; detail?: string }>({ status: 'not-ready' })
  const [progress, setProgress] = useState<{ step: string; detail?: string } | null>(null)
  const [reinstalling, setReinstalling] = useState(false)

  useEffect(() => {
    codr.getIndexerStatus?.().then(setStatus).catch(() => {})
    const unsub = codr.onIndexerSetupProgress?.((p: { step: string; detail?: string; projectDir?: string }) => {
      if (p.projectDir) return // ignore project-specific events
      setProgress(p)
      if (p.step === 'ready' || p.step === 'error') {
        codr.getIndexerStatus?.().then(setStatus).catch(() => {})
      }
    })
    return () => { unsub?.() }
  }, [codr])

  const statusBadge = (() => {
    switch (status.status) {
      case 'ready':
        return <span className="px-2 py-0.5 rounded text-[11px] bg-[#1a2e1a] text-[#50c878]">Ready</span>
      case 'setting-up':
        return <span className="px-2 py-0.5 rounded text-[11px] bg-[#2e2a1a] text-[#d4a845] animate-pulse">Setting up</span>
      case 'error':
        return <span className="px-2 py-0.5 rounded text-[11px] bg-[#2e1a1a] text-[#e06060]">Error</span>
      default:
        return <span className="px-2 py-0.5 rounded text-[11px] bg-[#222] text-text-dim">Not installed</span>
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
      <h3 className="m-0 mb-3 text-[13px] font-semibold text-text-faint uppercase tracking-[0.05em]">Indexer</h3>
      <div className="bg-bg-tertiary border border-border-subtle rounded-lg p-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2.5">
            <Database size={16} className="text-text-faint shrink-0" />
            <span className="text-[14px] text-[#e0e0e0] font-medium">Project Indexer</span>
          </div>
          {statusBadge}
        </div>
        {statusText && (
          <div className="text-[12px] text-text-faint mb-3 ml-6.5">{statusText}</div>
        )}
        {(status.status === 'error' || status.status === 'ready') && (
          <div className="flex gap-2 ml-6.5">
            <button
              className="bg-transparent border border-border text-text-faint py-1.5 px-3 rounded-md text-[12px] cursor-pointer transition-colors duration-150 hover:bg-border-subtle hover:text-[#ccc] disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => {
                setReinstalling(true)
                codr.reinstallIndexer?.()
                  .then(() => codr.getIndexerStatus?.().then(setStatus).catch(() => {}))
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
  const codr = useCodr()
  const [activeTab, setActiveTab] = useState<Tab>('general')
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null)
  const [providerStatus, setProviderStatus] = useState<Record<string, { installed: boolean; loggedIn: boolean; detail?: string; email?: string; org?: string }> | null>(null)
  // Fetch account info with retry — probe query may fail in packaged builds
  useEffect(() => {
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false
    let attempts = 0
    const MAX_ATTEMPTS = 6

    const fetchAccountInfo = () => {
      codr.getAccountInfo().then((result) => {
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

    const unsubAccountInfo = codr.onAccountInfoUpdate?.((info: AccountInfo) => {
      if (info) setAccountInfo(info)
    })

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      unsubAccountInfo?.()
    }
  }, [codr])

  // Fetch independent provider status for both Claude and Codex
  useEffect(() => {
    codr.getProviderStatus?.().then((status) => {
      if (status) setProviderStatus(status)
    }).catch(() => {})
  }, [codr])

  const tabBtnClass = (isActive: boolean) =>
    `bg-transparent border-0 border-b-2 px-5 py-3.5 text-[14px] cursor-pointer transition-colors duration-150 ${
      isActive
        ? 'text-[#e0e0e0] border-b-accent'
        : 'text-text-faint border-b-transparent hover:text-[#ccc]'
    } max-[768px]:px-3 max-[768px]:py-3 max-[768px]:text-[13px]`

  const sectionTitleClass = 'm-0 mb-3 text-[13px] font-semibold text-text-faint uppercase tracking-[0.05em]'

  return (
    <div className="flex flex-col flex-1 h-screen min-w-0 bg-bg-primary">
      {/* Topbar */}
      <div className="flex items-center justify-between px-4 border-b border-border-subtle shrink-0">
        <div className="flex gap-0">
          <button className={tabBtnClass(activeTab === 'general')} onClick={() => setActiveTab('general')}>General</button>
          <button className={tabBtnClass(activeTab === 'docs')} onClick={() => setActiveTab('docs')}>Docs</button>
          <button className={tabBtnClass(activeTab === 'files')} onClick={() => setActiveTab('files')}>Files</button>
          {import.meta.env.DEV && (
            <button className={tabBtnClass(activeTab === 'lab')} onClick={() => setActiveTab('lab')}>Lab</button>
          )}
        </div>
        <button
          className="bg-transparent border border-border text-text-faint w-8 h-8 rounded-md cursor-pointer flex items-center justify-center text-[16px] transition-colors duration-150 shrink-0 hover:bg-border-subtle hover:text-[#ccc]"
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
              <div className="flex items-center justify-between gap-3 bg-bg-tertiary border border-border-subtle rounded-lg p-4 max-[768px]:flex-col max-[768px]:items-start max-[768px]:gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  {userProfile?.imageUrl && (
                    <img
                      className="w-10 h-10 rounded-full object-cover shrink-0 border border-border"
                      src={userProfile.imageUrl}
                      alt={userProfile.fullName || 'User avatar'}
                      referrerPolicy="no-referrer"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    {userProfile?.fullName && (
                      <div className="text-[#e0e0e0] text-[15px] font-medium mb-0.5 overflow-hidden text-ellipsis whitespace-nowrap">{userProfile.fullName}</div>
                    )}
                    <div className="text-text-muted text-[13px] mb-2 overflow-hidden text-ellipsis whitespace-nowrap">
                      {userProfile?.email || accountInfo?.email || 'Loading...'}
                    </div>
                    {providerStatus && (
                      <div className="flex gap-1.5 flex-wrap">
                        {Object.entries(providerStatus).map(([id, ps]) => {
                          if (!ps.installed) return null
                          const theme = PROVIDER_THEME[id as keyof typeof PROVIDER_THEME]
                          if (!theme) return null
                          return (
                            <span key={id} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] ${
                              ps.loggedIn ? theme.badgeActive : theme.badgeInactive
                            }`}>
                              <ProviderLogo providerId={id} size={10} />
                              {ps.loggedIn
                                ? (ps.detail && ps.detail !== 'Ready' ? `${theme.label} · ${ps.detail}` : theme.label)
                                : `${theme.label} · not logged in`}
                            </span>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  className="bg-transparent border border-border text-text-faint py-2 px-4 rounded-md text-[13px] cursor-pointer transition-colors duration-150 shrink-0 hover:bg-border-subtle hover:text-[#ccc]"
                  onClick={() => { codr.disconnectRemote?.(); codr.signOut?.().then(() => window.location.reload()) }}
                >
                  Sign out
                </button>
              </div>
            </section>

            {/* Provider cards */}
            <section className="mb-8">
              <h3 className={sectionTitleClass}>Agent Provider</h3>
              <div className="flex gap-3">
                {Object.entries(PROVIDER_THEME).map(([id, theme]) => {
                  const status = providerStatus?.[id]
                  return (
                    <div
                      key={id}
                      className="flex-1 border border-border-subtle rounded-[10px] px-4 py-3.5 bg-bg-tertiary flex flex-col gap-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${theme.cardBg}`}>
                          <ProviderLogo providerId={id} size={18} />
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                          <span className="text-[15px] font-semibold text-[#e0e0e0]">{theme.label}</span>
                          {status?.detail && <span className="text-[12px] text-[#777]">{status.detail}</span>}
                        </div>
                      </div>
                      {status && (
                        <div className="flex flex-col gap-2.5 border-t border-border-subtle pt-2.5">
                          {(status.email || status.org) && (
                            <div className="flex flex-col gap-px">
                              {status.email && <span className="text-[12px] text-[#bbb] font-medium">{status.email}</span>}
                              {status.org && <span className="text-[11px] text-text-dim">{status.org}</span>}
                            </div>
                          )}
                          <div className="flex items-center gap-2 text-[12px]">
                            <span className={status.installed ? 'text-[#50c878]' : 'text-text-dim'}>
                              {status.installed ? 'Installed' : 'Not installed'}
                            </span>
                            <span className="w-0.75 h-0.75 rounded-full bg-[#444] shrink-0" />
                            <span className={status.loggedIn ? 'text-[#50c878]' : 'text-text-dim'}>
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

        {activeTab === 'files' && <GlobalFilesConfigPanel />}

        {activeTab === 'lab' && import.meta.env.DEV && <LabPanel />}
      </div>
    </div>
  )
}

// --- Chip list helper ---

function ChipList({
  items,
  onRemove,
  placeholder,
  onAdd,
}: {
  items: string[]
  onRemove: (item: string) => void
  placeholder: string
  onAdd: (item: string) => void
}) {
  const [input, setInput] = useState('')

  function commit() {
    const val = input.trim().replace(/\/$/, '')
    if (!val || items.includes(val)) { setInput(''); return }
    onAdd(val)
    setInput('')
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2 min-h-7">
        {items.map((item) => (
          <span
            key={item}
            className="flex items-center gap-1 px-2 py-0.5 bg-bg-tertiary border border-border-subtle rounded text-[12px] text-[#ccc] font-mono"
          >
            {item}
            <button
              className="bg-transparent border-0 text-[#555] cursor-pointer p-0 ml-0.5 leading-none hover:text-[#e06060]"
              onClick={() => onRemove(item)}
              title={`Remove ${item}`}
            >
              ×
            </button>
          </span>
        ))}
        {items.length === 0 && <span className="text-[12px] text-[#555] italic">None</span>}
      </div>
      <div className="flex gap-2">
        <input
          className="flex-1 bg-bg-tertiary border border-border-subtle text-[#e0e0e0] px-2.5 py-1.5 rounded text-[12px] outline-none focus:border-accent placeholder:text-[#555] font-mono"
          type="text"
          placeholder={placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
        />
        <button
          className="bg-[#2a2a3d] border border-[#3a3a5a] text-[#ccc] px-3 py-1.5 rounded text-[12px] cursor-pointer transition-colors hover:bg-[#3a3a5a] disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={commit}
          disabled={!input.trim()}
        >
          Add
        </button>
      </div>
    </div>
  )
}

// --- Global files config panel ---

function GlobalFilesConfigPanel() {
  const codr = useCodr()
  const [config, setConfig] = useState<Required<GlobalFilesConfigFile>>({
    ignoreDirs: [],
    extraIgnoreFiles: [],
  })

  useEffect(() => {
    codr.getGlobalFilesConfig?.().then((cfg) => {
      if (!cfg) return
      setConfig(cfg)
    }).catch(() => {})
  }, [codr])

  async function save(updates: Partial<GlobalFilesConfigFile>) {
    const updated = { ...config, ...updates }
    setConfig(updated as Required<GlobalFilesConfigFile>)
    await codr.setGlobalFilesConfig?.(updates).catch(() => {})
  }

  const sectionTitleClass = 'm-0 mb-3 text-[13px] font-semibold text-text-faint uppercase tracking-[0.05em]'

  return (
    <div>
      {/* Ignore dirs */}
      <section className="mb-8">
        <h3 className={sectionTitleClass}>Ignore Directories</h3>
        <div className="bg-bg-tertiary border border-border-subtle rounded-lg p-4">
          <div className="text-[12px] text-text-dim mb-3">
            Directory names excluded from file search across all projects.
          </div>
          <ChipList
            items={config.ignoreDirs}
            placeholder="e.g. tmp, out, .turbo"
            onAdd={(dir) => save({ ignoreDirs: [...config.ignoreDirs, dir] })}
            onRemove={(dir) => save({ ignoreDirs: config.ignoreDirs.filter((d) => d !== dir) })}
          />
        </div>
      </section>

      {/* Extra ignore files */}
      <section className="mb-8">
        <h3 className={sectionTitleClass}>Extra Ignore Files</h3>
        <div className="bg-bg-tertiary border border-border-subtle rounded-lg p-4">
          <div className="text-[12px] text-text-dim mb-3">
            Additional filenames to read as ignore-rule sources (e.g. <span className="font-mono">.npmignore</span>, <span className="font-mono">.dockerignore</span>). Applied to all projects.
          </div>
          <ChipList
            items={config.extraIgnoreFiles}
            placeholder="e.g. .npmignore"
            onAdd={(file) => save({ extraIgnoreFiles: [...config.extraIgnoreFiles, file] })}
            onRemove={(file) => save({ extraIgnoreFiles: config.extraIgnoreFiles.filter((f) => f !== file) })}
          />
        </div>
      </section>
    </div>
  )
}
