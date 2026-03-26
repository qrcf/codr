import { useState, useEffect, useRef, type FormEvent } from 'react'
import { RefreshCw, Trash2, Loader2, BookOpen, Plus, ExternalLink, Square, ChevronDown, ChevronRight, RotateCcw, Settings, CheckCircle2, Circle } from 'lucide-react'
import { useCodr } from '../../hooks/useCodr'

export interface DocSourceInfo {
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

export interface DocPageInfo {
  id: number
  url: string
  title: string | null
  crawledAt: string
}

export interface DocsAPI {
  sources: DocSourceInfo[]
  loading: boolean
  error: string | null
  refresh: () => void
  deleteSource: (sourceId: number) => Promise<void>
  fetchPages?: (sourceId: number) => Promise<DocPageInfo[]>
}

interface DocsPanelProps {
  docsAPI?: DocsAPI
  onAddDocSource?: (url: string, name: string, crawlDepth?: number, prefix?: string) => Promise<void>
  onRecrawlDocSource?: (sourceId: number, name: string, url: string, crawlDepth: number, prefix?: string) => Promise<void>
}

function derivePrefix(url: string): string {
  try {
    const parsed = new URL(url)
    const parts = parsed.pathname.replace(/\/$/, '').split('/')
    if (parts.length > 2) parts.pop()
    let result = parsed.origin + parts.join('/')
    if (result.endsWith('/') && parts.join('/') !== '/') result = result.slice(0, -1)
    return result
  } catch {
    return ''
  }
}

export function DocsPanel({ docsAPI, onAddDocSource, onRecrawlDocSource }: DocsPanelProps) {
  const codr = useCodr()
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
  const [setupProgress, setSetupProgress] = useState<{ step: string; detail?: string; stepIndex: number; totalSteps: number } | null>(null)
  const [isReinstalling, setIsReinstalling] = useState(false)
  const [isFetchingTitle, setIsFetchingTitle] = useState(false)
  const titleFetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nameManuallyEdited = useRef(false)

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => { if (titleFetchTimer.current) clearTimeout(titleFetchTimer.current) }
  }, [])

  // Listen for crawl progress updates
  useEffect(() => {
    if (!docsAPI) return
    return codr.onDocsCrawlProgress?.((progress) => {
      if (progress.status === 'crawling') {
        setCrawlProgress(prev => ({
          ...prev,
          [progress.sourceId]: { pagesCrawled: progress.pagesCrawled, currentUrl: progress.currentUrl },
        }))
      } else {
        setCrawlProgress(prev => {
          const next = { ...prev }
          delete next[progress.sourceId]
          return next
        })
        docsAPI.refresh()
      }
    })
  }, [docsAPI, codr])

  // Listen for setup progress updates (Python runtime installation)
  useEffect(() => {
    return codr.onDocsSetupProgress?.((progress: { step: string; detail?: string; stepIndex: number; totalSteps: number }) => {
      if (progress.step === 'ready') {
        setTimeout(() => setSetupProgress(null), 800)
      } else {
        setSetupProgress(progress)
      }
    })
  }, [codr])

  // Poll for doc source updates while panel is mounted (only shown when docs tab is active)
  useEffect(() => {
    if (!docsAPI) return
    const interval = setInterval(() => docsAPI.refresh(), 5000)
    return () => clearInterval(interval)
  }, [docsAPI])

  const handleAddDoc = async (e: FormEvent) => {
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
      nameManuallyEdited.current = false
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
      await codr.cancelDocCrawl?.(sourceId)
    } catch (err) {
      setDocError(err instanceof Error ? err.message : 'Failed to cancel')
    }
  }

  const handleRecrawlDoc = async (source: DocSourceInfo) => {
    if (!onRecrawlDocSource) return
    try {
      await onRecrawlDocSource(source.id, source.name, source.url, source.crawlDepth, source.prefix || undefined)
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

  const handleReinstallRuntime = async () => {
    setIsReinstalling(true)
    setDocError(null)
    try {
      const result = await codr.reinstallDocsRuntime?.()
      if (result?.error) {
        setDocError(result.error)
      }
    } catch (err) {
      setDocError(err instanceof Error ? err.message : 'Failed to reinstall runtime')
    } finally {
      setIsReinstalling(false)
    }
  }

  const spinClass = 'animate-[spin_1s_linear_infinite]'

  const getStatusBadge = (source: DocSourceInfo) => {
    const base = 'text-[11px] px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1'
    switch (source.status) {
      case 'ready':
        return <span className={`${base} bg-[rgba(80,200,120,0.15)] text-[#50c878]`}>Ready</span>
      case 'crawling': {
        const progress = crawlProgress[source.id]
        const label = progress ? `Crawling\u2026 ${progress.pagesCrawled} pages` : 'Crawling\u2026'
        return <span className={`${base} bg-accent/15 text-accent`}><Loader2 size={12} className={spinClass} /> {label}</span>
      }
      case 'error':
        return <span className={`${base} bg-[rgba(255,80,80,0.15)] text-error`}>Error</span>
      case 'pending':
        return <span className={`${base} bg-[rgba(255,180,50,0.15)] text-[#ffb432]`}>Pending</span>
      default:
        return <span className={`${base} bg-[rgba(255,255,255,0.05)] text-text-faint`}>{source.status}</span>
    }
  }

  const sectionTitleClass = 'm-0 mb-3 text-[13px] font-semibold text-text-faint uppercase tracking-[0.05em]'
  const inputClass = 'px-3 py-2 rounded-md border border-border bg-bg-primary text-[#e0e0e0] text-[13px] outline-none transition-colors duration-150 focus:border-accent'

  return (
    <div className="relative min-h-full">
      {/* Setup overlay */}
      {setupProgress && (
        <div className="absolute inset-0 bg-[rgba(18,18,24,0.92)] z-10 flex items-center justify-center backdrop-blur-xs">
          <div className="flex flex-col items-center gap-4 px-10 py-8 bg-[#1a1a2e] border border-border-subtle rounded-xl text-[#e0e0e0] max-w-85 w-full">
            <Settings size={24} className={spinClass} />
            <h3 className="m-0 text-[16px] font-semibold">Setting up crawl engine</h3>
            <div className="flex flex-col gap-2.5 w-full">
              {['Installing Python', 'Creating environment', 'Installing crawl4ai', 'Downloading browser'].map((label, i) => (
                <div
                  key={label}
                  className={`flex items-center gap-2 text-[13px] ${
                    i < setupProgress.stepIndex ? 'text-[#4ade80]' : i === setupProgress.stepIndex ? 'text-[#e0e0e0]' : 'text-[#555]'
                  }`}
                >
                  {i < setupProgress.stepIndex ? <CheckCircle2 size={14} /> : i === setupProgress.stepIndex ? <Loader2 size={14} className={spinClass} /> : <Circle size={14} />}
                  <span>{label}</span>
                </div>
              ))}
            </div>
            {setupProgress.detail && <div className="text-[11px] text-text-dim text-center">{setupProgress.detail}</div>}
            <div className="w-full h-0.75 bg-border-subtle rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-[width] duration-400"
                style={{ width: `${((setupProgress.stepIndex + 1) / setupProgress.totalSteps) * 100}%` }}
              />
            </div>
            <p className="m-0 text-[11px] text-[#555]">This only happens once</p>
          </div>
        </div>
      )}

      {/* Add Documentation */}
      <section className="mb-8">
        <h3 className={sectionTitleClass}>Add Documentation</h3>
        <p className="m-0 mb-4 text-[13px] text-text-dim leading-normal">
          Index documentation websites so the AI can reference them during conversations.
          Pages are crawled, chunked, and stored for fast full-text search.
        </p>
        <form onSubmit={handleAddDoc} className="bg-bg-tertiary border border-border-subtle rounded-lg p-4">
          <div className="flex gap-2 mb-2.5">
            <input
              type="url"
              placeholder="https://docs.example.com"
              value={docUrl}
              onChange={(e) => {
                const val = e.target.value
                setDocUrl(val)
                setDocPrefix(derivePrefix(val))

                if (titleFetchTimer.current) clearTimeout(titleFetchTimer.current)
                titleFetchTimer.current = setTimeout(async () => {
                  if (!val.trim()) return
                  try { new URL(val) } catch { return }
                  setIsFetchingTitle(true)
                  try {
                    const result = await codr.fetchDocTitle?.(val.trim())
                    if (result?.title && !nameManuallyEdited.current) {
                      setDocName(result.title)
                    }
                  } catch { /* user can type manually */ }
                  finally { setIsFetchingTitle(false) }
                }, 500)
              }}
              required
              className={`${inputClass} flex-2`}
            />
            <div style={{ position: 'relative', flex: 1 }}>
              <input
                type="text"
                placeholder={isFetchingTitle ? 'Fetching title...' : 'Display name'}
                value={docName}
                onChange={(e) => {
                  setDocName(e.target.value)
                  nameManuallyEdited.current = e.target.value.trim().length > 0
                }}
                required
                className={`${inputClass} w-full`}
              />
              {isFetchingTitle && <Loader2 size={14} className="spin" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }} />}
            </div>
          </div>
          <div className="flex gap-2 mb-2.5">
            <label className="text-[12px] text-text-faint whitespace-nowrap self-center">URL prefix:</label>
            <input
              type="text"
              placeholder="https://docs.example.com/api"
              value={docPrefix}
              onChange={(e) => setDocPrefix(e.target.value)}
              className={`${inputClass} flex-1`}
            />
          </div>
          <div className="flex gap-2 items-center">
            <label className="text-[12px] text-text-faint flex items-center gap-1.5">
              Crawl depth:
              <select
                value={docCrawlDepth}
                onChange={(e) => setDocCrawlDepth(parseInt(e.target.value))}
                className="px-2 py-1 rounded border border-border bg-bg-primary text-[#ccc] text-[12px]"
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3 (default)</option>
                <option value={4}>4</option>
                <option value={5}>5</option>
              </select>
            </label>
            <div className="flex-1" />
            <button
              type="submit"
              disabled={isAddingDoc || !docUrl.trim() || !docName.trim()}
              className="px-4 py-2 rounded-md border-none bg-accent text-white text-[13px] font-medium cursor-pointer flex items-center gap-1.5 transition-colors duration-150 hover:bg-[#9555d9] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isAddingDoc ? <Loader2 size={14} className={spinClass} /> : <Plus size={14} />}
              Add & Crawl
            </button>
          </div>
        </form>
      </section>

      {(docError || docsAPI?.error) && (
        <div className="my-3 px-3 py-2 rounded-md bg-[rgba(255,80,80,0.1)] border border-[rgba(255,80,80,0.3)] text-error text-[13px]">
          {docError || docsAPI?.error}
        </div>
      )}

      {/* Indexed Sources */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className={`${sectionTitleClass} mb-0!`}>
            Indexed Sources
            {docsAPI && docsAPI.sources.length > 0 && (
              <span className="font-normal text-text-dim normal-case tracking-normal"> ({docsAPI.sources.length})</span>
            )}
          </h3>
          <button
            className="p-1.25 rounded border border-border bg-transparent text-text-faint cursor-pointer flex items-center justify-center transition-colors duration-150 hover:text-[#ccc] hover:bg-border-subtle hover:border-[#3a3a5a] disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => docsAPI?.refresh()}
            disabled={docsAPI?.loading}
            title="Refresh sources"
          >
            <RefreshCw size={14} className={docsAPI?.loading ? spinClass : ''} />
          </button>
        </div>

        {docsAPI?.loading ? (
          <div className="flex items-center gap-2 text-text-dim text-[13px] py-4">
            <Loader2 size={16} className={spinClass} /> Loading sources...
          </div>
        ) : !docsAPI || docsAPI.sources.length === 0 ? (
          <div className="text-center py-10 px-5 text-[#555]">
            <BookOpen size={24} />
            <p className="mt-2 mb-0 text-[14px]">No documentation sources indexed yet.</p>
            <p className="mt-2 mb-0 text-[12px] text-[#444]">Add a URL above to get started.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {docsAPI.sources.map((source) => (
              <div key={source.id} className="px-4 py-3 rounded-lg border border-border-subtle bg-bg-tertiary transition-colors duration-150 hover:border-[#3a3a5a]">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    {source.pageCount > 0 ? (
                      <button
                        className="bg-transparent border-none p-0 m-0 cursor-pointer text-text-faint flex items-center shrink-0 hover:text-[#ccc]"
                        onClick={() => handleTogglePages(source.id)}
                        title={expandedSource === source.id ? 'Collapse pages' : 'Show pages'}
                      >
                        {expandedSource === source.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    ) : (
                      <BookOpen size={14} />
                    )}
                    <span className="font-semibold text-[14px] text-[#ddd]">{source.name}</span>
                    {getStatusBadge(source)}
                  </div>
                  <div className="flex gap-1">
                    {source.status === 'crawling' ? (
                      <button
                        onClick={() => handleCancelCrawl(source.id)}
                        title="Stop crawl"
                        className="p-1 rounded border-none bg-transparent text-text-dim cursor-pointer transition-colors duration-150 hover:text-error hover:bg-border-subtle"
                      >
                        <Square size={14} />
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => handleRecrawlDoc(source)}
                          title="Re-crawl"
                          className="p-1 rounded border-none bg-transparent text-text-dim cursor-pointer transition-colors duration-150 hover:text-[#ccc] hover:bg-border-subtle"
                        >
                          <RefreshCw size={14} />
                        </button>
                        <button
                          onClick={() => handleDeleteDoc(source.id)}
                          title="Delete"
                          className="p-1 rounded border-none bg-transparent text-text-dim cursor-pointer transition-colors duration-150 hover:text-error hover:bg-border-subtle"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[12px] text-text-dim">
                  <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-inherit no-underline flex items-center gap-0.75 transition-colors duration-150 hover:text-text-muted">
                    {source.url} <ExternalLink size={10} />
                  </a>
                  {source.pageCount > 0 && <span>{source.pageCount} pages</span>}
                  {source.lastCrawledAt && <span>Crawled {new Date(source.lastCrawledAt).toLocaleDateString()}</span>}
                </div>
                {source.status === 'crawling' && crawlProgress[source.id]?.currentUrl && (
                  <div className="mt-1 text-[11px] text-text-faint overflow-hidden text-ellipsis whitespace-nowrap">
                    {crawlProgress[source.id].currentUrl}
                  </div>
                )}
                {source.status === 'error' && source.errorMessage && (
                  <div className="mt-1.5 text-[12px] text-error">
                    Error: {source.errorMessage}
                  </div>
                )}
                {expandedSource === source.id && (
                  <div className="max-h-50 overflow-y-auto border-t border-border-subtle mt-2 pt-1">
                    {loadingPages === source.id ? (
                      <div className="flex items-center gap-1.5 px-2 py-1.5 text-[12px] text-text-dim">
                        <Loader2 size={12} className={spinClass} /> Loading pages...
                      </div>
                    ) : sourcePages[source.id]?.length ? (
                      sourcePages[source.id].map((page) => (
                        <div key={page.id} className="flex items-center gap-2 px-2 py-0.75 text-[12px] text-[#aaa] overflow-hidden hover:bg-[rgba(255,255,255,0.04)]">
                          <span className="whitespace-nowrap overflow-hidden text-ellipsis min-w-0 flex-1">{page.title || page.url}</span>
                          <a href={page.url} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap overflow-hidden text-ellipsis text-[#555] text-[11px] shrink-0 max-w-[40%] no-underline hover:text-text-faint">
                            {page.url}
                          </a>
                        </div>
                      ))
                    ) : (
                      <div className="flex items-center gap-1.5 px-2 py-1.5 text-[12px] text-text-dim">No pages found</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Crawl Engine */}
      <section className="mb-8 border-t border-border-subtle mt-2 pt-4">
        <h3 className={sectionTitleClass}>Crawl Engine</h3>
        <div className="flex items-center justify-between gap-4">
          <span className="text-[13px] text-text-faint">Python runtime used for crawling documentation sites.</span>
          <button
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-transparent border border-border rounded-md text-[#ccc] text-[13px] cursor-pointer whitespace-nowrap transition-colors duration-150 hover:enabled:bg-border-subtle hover:enabled:border-[#444] disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleReinstallRuntime}
            disabled={isReinstalling}
          >
            {isReinstalling ? <Loader2 size={14} className={spinClass} /> : <RotateCcw size={14} />}
            {isReinstalling ? 'Reinstalling...' : 'Reinstall Runtime'}
          </button>
        </div>
      </section>
    </div>
  )
}
