import { useState, useEffect } from 'react'
import { useClerk } from '@clerk/clerk-react'
import { RefreshCw, Trash2, Loader2, BookOpen, Plus, ExternalLink, Square, ChevronDown, ChevronRight } from 'lucide-react'
import './SettingsPanel.css'

interface DocSourceInfo {
  id: number
  url: string
  name: string
  status: string
  crawlDepth: number
  prefix: string | null
  pageCount: number
  lastCrawledAt: string | null
  errorMessage: string | null
}

interface DocPageInfo {
  id: number
  url: string
  title: string | null
  crawledAt: string
}

interface DocsAPI {
  sources: DocSourceInfo[]
  loading: boolean
  error: string | null
  refresh: () => void
  deleteSource: (sourceId: number) => Promise<void>
  fetchPages?: (sourceId: number) => Promise<DocPageInfo[]>
}

interface SettingsPanelProps {
  onClose: () => void
  docsAPI?: DocsAPI
  onAddDocSource?: (url: string, name: string, crawlDepth?: number, prefix?: string) => Promise<void>
  onRecrawlDocSource?: (sourceId: number, url: string, crawlDepth: number, prefix?: string) => Promise<void>
}

/**
 * Derive a URL prefix from a documentation URL by stripping the last path segment.
 * e.g. https://docs.example.com/api/v2/getting-started → https://docs.example.com/api/v2
 */
function derivePrefix(url: string): string {
  try {
    const parsed = new URL(url)
    const parts = parsed.pathname.replace(/\/$/, '').split('/')
    if (parts.length > 1) parts.pop()
    let result = parsed.origin + parts.join('/')
    if (result.endsWith('/') && parts.join('/') !== '/') result = result.slice(0, -1)
    return result
  } catch {
    return ''
  }
}

type Tab = 'general' | 'docs' | 'lab'

export function SettingsPanel({ onClose, docsAPI, onAddDocSource, onRecrawlDocSource }: SettingsPanelProps) {
  const { signOut } = useClerk()
  const [activeTab, setActiveTab] = useState<Tab>('general')
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [sessionDetail, setSessionDetail] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // Docs tab state
  const [docUrl, setDocUrl] = useState('')
  const [docName, setDocName] = useState('')
  const [docCrawlDepth, setDocCrawlDepth] = useState(3)
  const [docPrefix, setDocPrefix] = useState('')
  const [isAddingDoc, setIsAddingDoc] = useState(false)
  const [docError, setDocError] = useState<string | null>(null)
  const [crawlProgress, setCrawlProgress] = useState<Record<number, { pagesCrawled: number; currentUrl?: string }>>({})
  const [expandedSource, setExpandedSource] = useState<number | null>(null)
  const [sourcePages, setSourcePages] = useState<Record<number, DocPageInfo[]>>({})
  const [loadingPages, setLoadingPages] = useState<number | null>(null)

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

  // Listen for crawl progress updates
  useEffect(() => {
    if (!docsAPI) return
    const cleanup = window.claude.onDocsCrawlProgress?.((progress) => {
      if (progress.status === 'crawling') {
        setCrawlProgress(prev => ({
          ...prev,
          [progress.sourceId]: { pagesCrawled: progress.pagesCrawled, currentUrl: progress.currentUrl },
        }))
      } else {
        // Clear progress on complete/error and refresh source list
        setCrawlProgress(prev => {
          const next = { ...prev }
          delete next[progress.sourceId]
          return next
        })
        docsAPI.refresh()
      }
    })
    return cleanup
  }, [docsAPI])

  // Poll for doc source updates while docs tab is visible
  useEffect(() => {
    if (activeTab !== 'docs' || !docsAPI) return
    const interval = setInterval(() => docsAPI.refresh(), 5000)
    return () => clearInterval(interval)
  }, [activeTab, docsAPI])

  const handleListSessions = async () => {
    setSessionsLoading(true)
    try {
      const result = await window.claude.listSessions()
      setSessions(result.sessions)
    } catch {
      setSessions([])
    } finally {
      setSessionsLoading(false)
    }
  }

  const handleSelectSession = async (sessionId: string) => {
    if (selectedSession === sessionId) {
      setSelectedSession(null)
      setSessionDetail(null)
      return
    }
    setSelectedSession(sessionId)
    setSessionDetail(null)
    setDetailLoading(true)
    try {
      const messages = await window.claude.getSessionMessages(sessionId)
      setSessionDetail(JSON.stringify(messages, null, 2))
    } catch (err) {
      setSessionDetail(JSON.stringify({ error: String(err) }, null, 2))
    } finally {
      setDetailLoading(false)
    }
  }

  // Docs handlers
  const handleAddDoc = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!docUrl.trim() || !docName.trim() || !onAddDocSource) return

    setIsAddingDoc(true)
    setDocError(null)
    try {
      await onAddDocSource(docUrl.trim(), docName.trim(), docCrawlDepth, docPrefix.trim() || undefined)
      setDocUrl('')
      setDocName('')
      setDocCrawlDepth(3)
      setDocPrefix('')
      docsAPI?.refresh()
    } catch (err) {
      setDocError(err instanceof Error ? err.message : 'Failed to add doc source')
    } finally {
      setIsAddingDoc(false)
    }
  }

  const handleDeleteDoc = async (sourceId: number) => {
    if (!docsAPI) return
    try {
      await docsAPI.deleteSource(sourceId)
    } catch (err) {
      setDocError(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  const handleCancelCrawl = async (sourceId: number) => {
    try {
      await window.claude.cancelDocCrawl?.(sourceId)
    } catch (err) {
      setDocError(err instanceof Error ? err.message : 'Failed to cancel')
    }
  }

  const handleRecrawlDoc = async (source: DocSourceInfo) => {
    if (!onRecrawlDocSource) return
    try {
      await onRecrawlDocSource(source.id, source.url, source.crawlDepth, source.prefix || undefined)
      docsAPI?.refresh()
    } catch (err) {
      setDocError(err instanceof Error ? err.message : 'Failed to recrawl')
    }
  }

  const handleTogglePages = async (sourceId: number) => {
    if (expandedSource === sourceId) {
      setExpandedSource(null)
      return
    }
    setExpandedSource(sourceId)
    // Fetch pages if not cached
    if (!sourcePages[sourceId] && docsAPI?.fetchPages) {
      setLoadingPages(sourceId)
      try {
        const pages = await docsAPI.fetchPages(sourceId)
        setSourcePages(prev => ({ ...prev, [sourceId]: pages }))
      } catch (err) {
        console.error('Failed to fetch pages:', err)
      } finally {
        setLoadingPages(null)
      }
    }
  }

  const getStatusBadge = (source: DocSourceInfo) => {
    switch (source.status) {
      case 'ready':
        return <span className="docs-status-badge docs-status-ready">Ready</span>
      case 'crawling': {
        const progress = crawlProgress[source.id]
        const label = progress ? `Crawling\u2026 ${progress.pagesCrawled} pages` : 'Crawling\u2026'
        return <span className="docs-status-badge docs-status-crawling"><Loader2 size={12} className="spin" /> {label}</span>
      }
      case 'error':
        return <span className="docs-status-badge docs-status-error">Error</span>
      case 'pending':
        return <span className="docs-status-badge docs-status-pending">Pending</span>
      default:
        return <span className="docs-status-badge">{source.status}</span>
    }
  }

  return (
    <div className="settings-panel">
      <div className="settings-topbar">
        <div className="settings-tabs">
          <button className={activeTab === 'general' ? 'active' : ''} onClick={() => setActiveTab('general')}>
            General
          </button>
          <button className={activeTab === 'docs' ? 'active' : ''} onClick={() => setActiveTab('docs')}>
            Docs
          </button>
          <button className={activeTab === 'lab' ? 'active' : ''} onClick={() => setActiveTab('lab')}>
            Lab
          </button>
        </div>
        <button className="btn-close-settings" onClick={onClose} title="Close settings">
          ✕
        </button>
      </div>

      <div className="settings-body">
        {activeTab === 'general' && (
          <div className="settings-general">
            <section className="settings-section">
              <h3 className="settings-section-title">Account</h3>
              <div className="settings-account-card">
                {accountInfo ? (
                  <>
                    <div className="settings-account-details">
                      {accountInfo.email && <div className="settings-account-email">{accountInfo.email}</div>}
                      <div className="settings-account-badges">
                        {accountInfo.subscriptionType && (
                          <span className="settings-account-badge">{accountInfo.subscriptionType}</span>
                        )}
                        {accountInfo.apiKeySource && (
                          <span className="settings-account-badge">{accountInfo.apiKeySource}</span>
                        )}
                      </div>
                    </div>
                    <button className="btn-sign-out-settings" onClick={() => {
                      window.claude.disconnectRemote?.()
                      signOut()
                    }}>
                      Sign out
                    </button>
                  </>
                ) : (
                  <div className="settings-account-loading">Loading account info...</div>
                )}
              </div>
            </section>
          </div>
        )}

        {activeTab === 'docs' && (
          <div className="settings-docs">
            <section className="settings-section">
              <h3 className="settings-section-title">Add Documentation</h3>
              <p className="settings-section-description">
                Index documentation websites so the AI can reference them during conversations.
                Pages are crawled, chunked, and stored for fast full-text search.
              </p>
              <form onSubmit={handleAddDoc} className="docs-add-form">
                <div className="docs-add-row">
                  <input
                    type="url"
                    placeholder="https://docs.example.com"
                    value={docUrl}
                    onChange={(e) => {
                      setDocUrl(e.target.value)
                      setDocPrefix(derivePrefix(e.target.value))
                    }}
                    required
                    className="docs-input docs-input-url"
                  />
                  <input
                    type="text"
                    placeholder="Display name"
                    value={docName}
                    onChange={(e) => setDocName(e.target.value)}
                    required
                    className="docs-input docs-input-name"
                  />
                </div>
                <div className="docs-add-row">
                  <label className="docs-prefix-label">URL prefix:</label>
                  <input
                    type="text"
                    placeholder="https://docs.example.com/api"
                    value={docPrefix}
                    onChange={(e) => setDocPrefix(e.target.value)}
                    className="docs-input docs-input-prefix"
                  />
                </div>
                <div className="docs-add-actions">
                  <label className="docs-depth-label">
                    Crawl depth:
                    <select
                      value={docCrawlDepth}
                      onChange={(e) => setDocCrawlDepth(parseInt(e.target.value))}
                      className="docs-depth-select"
                    >
                      <option value={1}>1</option>
                      <option value={2}>2</option>
                      <option value={3}>3 (default)</option>
                      <option value={4}>4</option>
                      <option value={5}>5</option>
                    </select>
                  </label>
                  <div style={{ flex: 1 }} />
                  <button
                    type="submit"
                    disabled={isAddingDoc || !docUrl.trim() || !docName.trim()}
                    className="docs-add-btn"
                  >
                    {isAddingDoc ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
                    Add & Crawl
                  </button>
                </div>
              </form>
            </section>

            {(docError || docsAPI?.error) && (
              <div className="docs-error">
                {docError || docsAPI?.error}
              </div>
            )}

            <section className="settings-section">
              <div className="docs-sources-header">
                <h3 className="settings-section-title">
                  Indexed Sources
                {docsAPI && docsAPI.sources.length > 0 && (
                  <span className="docs-count"> ({docsAPI.sources.length})</span>
                )}
              </h3>
                <button
                  className="docs-refresh-btn"
                  onClick={() => docsAPI?.refresh()}
                  disabled={docsAPI?.loading}
                  title="Refresh sources"
                >
                  <RefreshCw size={14} className={docsAPI?.loading ? 'spin' : ''} />
                </button>
              </div>

              {docsAPI?.loading ? (
                <div className="docs-loading">
                  <Loader2 size={16} className="spin" /> Loading sources...
                </div>
              ) : !docsAPI || docsAPI.sources.length === 0 ? (
                <div className="docs-empty">
                  <BookOpen size={24} />
                  <p>No documentation sources indexed yet.</p>
                  <p className="docs-empty-hint">Add a URL above to get started.</p>
                </div>
              ) : (
                <div className="docs-source-list">
                  {docsAPI.sources.map((source) => (
                    <div key={source.id} className="docs-source-card">
                      <div className="docs-source-header">
                        <div className="docs-source-info">
                          {source.pageCount > 0 ? (
                            <button
                              className="docs-expand-btn"
                              onClick={() => handleTogglePages(source.id)}
                              title={expandedSource === source.id ? 'Collapse pages' : 'Show pages'}
                            >
                              {expandedSource === source.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                          ) : (
                            <BookOpen size={14} />
                          )}
                          <span className="docs-source-name">{source.name}</span>
                          {getStatusBadge(source)}
                        </div>
                        <div className="docs-source-actions">
                          {source.status === 'crawling' ? (
                            <button
                              onClick={() => handleCancelCrawl(source.id)}
                              title="Stop crawl"
                              className="docs-action-btn docs-action-delete"
                            >
                              <Square size={14} />
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={() => handleRecrawlDoc(source)}
                                title="Re-crawl"
                                className="docs-action-btn"
                              >
                                <RefreshCw size={14} />
                              </button>
                              <button
                                onClick={() => handleDeleteDoc(source.id)}
                                title="Delete"
                                className="docs-action-btn docs-action-delete"
                              >
                                <Trash2 size={14} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="docs-source-meta">
                        <a href={source.url} target="_blank" rel="noopener noreferrer" className="docs-source-url">
                          {source.url} <ExternalLink size={10} />
                        </a>
                        {source.pageCount > 0 && <span>{source.pageCount} pages</span>}
                        {source.lastCrawledAt && <span>Crawled {new Date(source.lastCrawledAt).toLocaleDateString()}</span>}
                      </div>
                      {source.status === 'crawling' && crawlProgress[source.id]?.currentUrl && (
                        <div className="docs-crawl-url">{crawlProgress[source.id].currentUrl}</div>
                      )}
                      {source.status === 'error' && source.errorMessage && (
                        <div className="docs-source-error">
                          Error: {source.errorMessage}
                        </div>
                      )}
                      {expandedSource === source.id && (
                        <div className="docs-pages-list">
                          {loadingPages === source.id ? (
                            <div className="docs-pages-loading"><Loader2 size={12} className="spin" /> Loading pages...</div>
                          ) : sourcePages[source.id]?.length ? (
                            sourcePages[source.id].map((page) => (
                              <div key={page.id} className="docs-page-row">
                                <span className="docs-page-title">{page.title || page.url}</span>
                                <a href={page.url} target="_blank" rel="noopener noreferrer" className="docs-page-url">
                                  {page.url}
                                </a>
                              </div>
                            ))
                          ) : (
                            <div className="docs-pages-empty">No pages found</div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {activeTab === 'lab' && (
          <div className="settings-lab">
            <section className="settings-section">
              <h3 className="settings-section-title">Sessions</h3>
              <button className="btn-lab-action" onClick={handleListSessions} disabled={sessionsLoading}>
                {sessionsLoading ? 'Loading...' : sessions.length ? 'Refresh Sessions' : 'Load Sessions'}
              </button>

              {sessions.length > 0 && (
                <div className="lab-session-list">
                  {sessions.map((s) => (
                    <div key={s.sessionId} className="lab-session-item-wrapper">
                      <button
                        className={`lab-session-item${selectedSession === s.sessionId ? ' active' : ''}`}
                        onClick={() => handleSelectSession(s.sessionId)}
                      >
                        <div className="lab-session-title">
                          {s.customTitle || s.generatedTitle || s.summary || s.sessionId.slice(0, 8)}
                        </div>
                        <div className="lab-session-meta">
                          <span>{s.sessionId.slice(0, 8)}</span>
                          {s.cwd && <span>{s.cwd.split('/').pop()}</span>}
                          <span>{new Date(s.lastModified).toLocaleDateString()}</span>
                        </div>
                        <div className="lab-session-tooltip">
                          <pre>{JSON.stringify(s, null, 2)}</pre>
                        </div>
                      </button>

                      {selectedSession === s.sessionId && (
                        <div className="lab-output">
                          {detailLoading ? (
                            <div className="lab-detail-loading">Loading session messages...</div>
                          ) : (
                            <pre>{sessionDetail}</pre>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
