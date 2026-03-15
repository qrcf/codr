import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Search, Check, RefreshCw } from 'lucide-react'
import { useCodr } from '../hooks/useCodr'

interface ReferenceFinderDialogProps {
  isOpen: boolean
  onClose: () => void
  onApprove: (files: string[]) => void
  projectFolder: string | null
  currentSelectedFiles: string[]
  indexerStatus?: string
}

type Phase = 'input' | 'loading' | 'results'
type FilterType = 'all' | 'config' | 'code' | 'docs'
type ProjectIndexStatus = 'unknown' | 'not-indexed' | 'indexing' | 'indexed' | 'error'

interface SearchResult {
  path: string
  score: number
  text?: string
}

const CONFIG_EXTS = /\.(json|yaml|yml|toml|ini|xml|lock|nvmrc|gitignore|gitattributes|editorconfig|eslintrc|prettierrc|babelrc)$|\/\.env/
const CODE_EXTS = /\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|c|cpp|h|cs|rb|php|swift|kt|sh|bash)$/
const DOCS_EXTS = /\.(md|mdx|txt|rst|adoc)$/

const HISTORY_KEY = 'ref-search-history'
const MAX_HISTORY = 20

function loadHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
  } catch {
    return []
  }
}

function saveHistory(entries: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries))
  } catch { /* ignore */ }
}

function filterResults(results: SearchResult[], filter: FilterType): SearchResult[] {
  if (filter === 'all') return results
  const re = filter === 'config' ? CONFIG_EXTS : filter === 'code' ? CODE_EXTS : DOCS_EXTS
  const name = (p: string) => p.split('/').pop() ?? p
  return results.filter(r => re.test(name(r.path)))
}

export function ReferenceFinderDialog({ isOpen, onClose, onApprove, projectFolder, currentSelectedFiles, indexerStatus }: ReferenceFinderDialogProps) {
  const codr = useCodr()
  const [phase, setPhase] = useState<Phase>('input')
  const [prompt, setPrompt] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterType>('all')
  const [isCached, setIsCached] = useState(false)
  const [searchHistory, setSearchHistory] = useState<string[]>(loadHistory)
  const [showHistory, setShowHistory] = useState(false)
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [projectIndexStatus, setProjectIndexStatus] = useState<ProjectIndexStatus>('unknown')
  const [buildingIndex, setBuildingIndex] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const cache = useRef<Map<string, SearchResult[]>>(new Map())
  const hideHistoryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const displayResults = filterResults(results, filter)

  // Fetch per-project index status when dialog opens
  useEffect(() => {
    if (!isOpen || !projectFolder) return
    let cancelled = false

    codr.getIndexerProjectStatus?.(projectFolder).then((s) => {
      if (cancelled) return
      setProjectIndexStatus((s?.status as ProjectIndexStatus | undefined) || 'not-indexed')
    }).catch(() => {})

    // Listen for project-specific progress
    const unsub = codr.onIndexerSetupProgress?.((p: { step: string; projectDir?: string }) => {
      if (cancelled) return
      if (p.projectDir !== projectFolder) return
      if (p.step === 'indexed') {
        setProjectIndexStatus('indexed')
        setBuildingIndex(false)
      } else if (p.step === 'indexing') {
        setProjectIndexStatus('indexing')
        setBuildingIndex(true)
      } else if (p.step === 'error') {
        setProjectIndexStatus('error')
        setBuildingIndex(false)
      }
    })
    return () => {
      cancelled = true
      unsub?.()
    }
  }, [isOpen, projectFolder, codr])

  // Focus input on open
  useEffect(() => {
    if (isOpen && phase === 'input') {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen, phase])

  // Escape to close
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [isOpen, onClose])

  const handleBuildIndex = useCallback(async () => {
    if (!projectFolder || indexerStatus !== 'ready') return
    setBuildingIndex(true)
    try {
      await codr.rebuildIndex?.(projectFolder)
    } catch {
      setBuildingIndex(false)
    }
  }, [projectFolder, indexerStatus, codr])

  const runSearch = useCallback(async (q: string, skipCache = false) => {
    if (!q || !projectFolder) return

    setPhase('loading')
    setError(null)
    setFilter('all')

    const cacheKey = q

    if (!skipCache && cache.current.has(cacheKey)) {
      const cached = cache.current.get(cacheKey)!
      setResults(cached)
      setChecked(new Set(cached.map(r => r.path)))
      setIsCached(true)
      setPhase('results')
      return
    }

    try {
      const raw = await codr.indexerSearch?.(q, projectFolder)
      if (!raw || raw.length === 0) {
        setError('No matching files found. Try a different description.')
        setPhase('input')
        return
      }

      // Deduplicate by path, keep highest score
      const seen = new Map<string, SearchResult>()
      for (const r of raw) {
        if (!seen.has(r.path) || r.score > seen.get(r.path)!.score) seen.set(r.path, r)
      }
      const deduped = [...seen.values()].filter(r => !currentSelectedFiles.includes(r.path) && !r.path.endsWith('.DS_Store'))

      cache.current.set(cacheKey, deduped)
      setResults(deduped)
      setChecked(new Set(deduped.map(r => r.path)))
      setIsCached(false)
      setPhase('results')

      // Save to history
      setSearchHistory(prev => {
        const next = [q, ...prev.filter(h => h !== q)].slice(0, MAX_HISTORY)
        saveHistory(next)
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('input')
    }
  }, [projectFolder, currentSelectedFiles, codr])

  const handleSearch = useCallback(() => {
    const q = prompt.trim()
    if (!q) return
    setShowHistory(false)
    runSearch(q)
  }, [prompt, runSearch])

  const handleRefresh = useCallback(() => {
    const q = prompt.trim()
    if (!q) return
    cache.current.delete(q)
    runSearch(q, true)
  }, [prompt, runSearch])

  const handleApprove = () => {
    const files = results.filter(r => checked.has(r.path)).map(r => r.path)
    if (files.length > 0) {
      onApprove(files)
    }
    onClose()
  }

  const handleReprompt = () => {
    setPhase('input')
    setResults([])
    setError(null)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const toggleFile = (path: string) => {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const toggleAll = () => {
    if (checked.size === results.length) {
      setChecked(new Set())
    } else {
      setChecked(new Set(results.map(r => r.path)))
    }
  }

  const matchingHistory = prompt.trim()
    ? searchHistory.filter(h => h.toLowerCase().includes(prompt.toLowerCase()) && h !== prompt.trim())
    : searchHistory

  const handleHistorySelect = (entry: string) => {
    setPrompt(entry)
    setShowHistory(false)
    setHistoryIndex(-1)
    setTimeout(() => runSearch(entry), 0)
  }

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showHistory && matchingHistory.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHistoryIndex(i => Math.min(i + 1, matchingHistory.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHistoryIndex(i => Math.max(i - 1, -1))
        return
      }
      if (e.key === 'Enter' && historyIndex >= 0) {
        e.preventDefault()
        handleHistorySelect(matchingHistory[historyIndex])
        return
      }
      if (e.key === 'Escape') {
        setShowHistory(false)
        setHistoryIndex(-1)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSearch()
    }
  }

  if (!isOpen) return null

  const filterLabels: { key: FilterType; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'config', label: 'Config' },
    { key: 'code', label: 'Code' },
    { key: 'docs', label: 'Docs' },
  ]

  return (
    <div className="fixed inset-0 z-200 flex items-center justify-center bg-black/50" onMouseDown={onClose}>
      <div
        className="bg-bg-card border border-[#444] rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] w-115 max-h-[70vh] flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Search size={14} className="text-[#a78bfa]" />
            <span className="text-[14px] font-medium text-[#e0e0e0]">Find references</span>
          </div>
          <button
            className="bg-transparent border-none text-text-dim cursor-pointer p-1 rounded hover:text-[#ccc] hover:bg-[#2a2a3d]"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className={`min-h-0 flex-1 px-4 py-3 ${phase === 'input' ? 'overflow-visible' : 'overflow-y-auto'}`}>
          {/* Global indexer not installed */}
          {indexerStatus && indexerStatus !== 'ready' && (
            <div className="text-[11px] text-[#d4a845] mb-2 px-1">
              {indexerStatus === 'setting-up'
                ? 'Indexer is installing — please wait...'
                : 'Indexer is not installed — search is unavailable.'}
            </div>
          )}
          {/* Project not indexed — offer to build */}
          {indexerStatus === 'ready' && projectIndexStatus === 'not-indexed' && !buildingIndex && (
            <div className="flex items-center justify-between bg-[#2a2520] border border-[#3a3020] rounded-md px-3 py-2 mb-2">
              <span className="text-[11px] text-[#d4a845]">This project hasn&apos;t been indexed yet.</span>
              <button
                className="text-[11px] text-[#a78bfa] bg-transparent border border-[#a78bfa33] px-2 py-0.5 rounded cursor-pointer hover:bg-[#a78bfa22]"
                onClick={handleBuildIndex}
              >
                Build Index
              </button>
            </div>
          )}
          {/* Index building */}
          {(projectIndexStatus === 'indexing' || buildingIndex) && (
            <div className="flex items-center gap-2 text-[11px] text-[#d4a845] mb-2 px-1">
              <div className="w-3 h-3 border-2 border-border border-t-[#d4a845] rounded-full animate-[spin_0.8s_linear_infinite]" />
              Index is building — search may return incomplete results.
            </div>
          )}
          {/* Project index error */}
          {projectIndexStatus === 'error' && (
            <div className="text-[11px] text-[#e06060] mb-2 px-1">
              Index error — try rebuilding from Project Settings.
            </div>
          )}

          {/* Input phase */}
          {phase === 'input' && (
            <div>
              <label className="text-[12px] text-text-faint block mb-1.5">
                Describe what you want to work on
              </label>
              <div className="flex gap-2 relative">
                <div className="flex-1 relative">
                  <input
                    ref={inputRef}
                    className="w-full bg-[#141420] border border-border text-[#e0e0e0] px-3 py-2 rounded-md text-[13px] outline-none transition-colors duration-150 focus:border-[#a78bfa] placeholder:text-[#555]"
                    type="text"
                    placeholder="e.g., authentication flow, sidebar layout..."
                    value={prompt}
                    onChange={(e) => {
                      setPrompt(e.target.value)
                      setHistoryIndex(-1)
                      setShowHistory(true)
                    }}
                    onFocus={() => setShowHistory(true)}
                    onBlur={() => {
                      hideHistoryTimer.current = setTimeout(() => setShowHistory(false), 150)
                    }}
                    onKeyDown={handleInputKeyDown}
                  />
                  {/* History autocomplete dropdown */}
                  {showHistory && matchingHistory.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 z-10 bg-[#1a1a2e] border border-border rounded-md shadow-lg overflow-hidden">
                      {matchingHistory.slice(0, 5).map((entry, i) => (
                        <div
                          key={entry}
                          className={`px-3 py-1.5 text-[12px] font-mono text-[#ccc] cursor-pointer truncate ${
                            i === historyIndex ? 'bg-[#2a2a3d] text-white' : 'hover:bg-[#252535]'
                          }`}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            if (hideHistoryTimer.current) clearTimeout(hideHistoryTimer.current)
                            handleHistorySelect(entry)
                          }}
                        >
                          {entry}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  className="bg-[#7c3aed] border-none text-white px-4 py-2 rounded-md cursor-pointer text-[13px] font-medium transition-colors duration-150 whitespace-nowrap hover:bg-[#6d28d9] disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleSearch}
                  disabled={!prompt.trim() || !projectFolder}
                >
                  Find
                </button>
              </div>
              {currentSelectedFiles.length > 0 && (
                <div className="mt-3 text-[11px] text-text-dim">
                  Currently attached: {currentSelectedFiles.map(f => f.split('/').pop()).join(', ')}
                </div>
              )}
              {error && (
                <div className="mt-2 text-[12px] text-[#e06060]">{error}</div>
              )}
            </div>
          )}

          {/* Loading phase */}
          {phase === 'loading' && (
            <div className="flex items-center justify-center gap-2.5 py-8 text-text-faint">
              <div className="w-4 h-4 border-2 border-border border-t-[#a78bfa] rounded-full animate-[spin_0.8s_linear_infinite]" />
              <span className="text-[13px]">Searching index...</span>
            </div>
          )}

          {/* Results phase */}
          {phase === 'results' && (
            <div>
              {/* Count + refresh + select-all row */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] text-text-faint">
                    {displayResults.length} file{displayResults.length !== 1 ? 's' : ''} found
                  </span>
                  {isCached && (
                    <button
                      className="p-0.5 rounded text-[#555] hover:text-[#a78bfa] transition-colors duration-100"
                      title="Refresh results"
                      onClick={handleRefresh}
                    >
                      <RefreshCw size={11} />
                    </button>
                  )}
                </div>
                <button
                  className="text-[11px] text-[#a78bfa] bg-transparent border-none cursor-pointer hover:text-[#c4b5fd]"
                  onClick={toggleAll}
                >
                  {checked.size === results.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>

              {/* Filter chips */}
              <div className="flex items-center gap-1.5 mb-2.5">
                {filterLabels.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setFilter(key)}
                    className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors duration-100 cursor-pointer ${
                      filter === key
                        ? 'bg-[#7c3aed] border-[#7c3aed] text-white'
                        : 'bg-transparent border-border text-text-faint hover:bg-[#2a2a3d] hover:text-[#ccc]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-0.5">
                {displayResults.length === 0 ? (
                  <div className="text-[12px] text-text-dim px-1 py-2">No {filter} files in results.</div>
                ) : (
                  displayResults.map((r) => (
                    <label
                      key={r.path}
                      className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md cursor-pointer transition-colors duration-100 ${
                        checked.has(r.path) ? 'bg-[#2a2a3d]' : 'hover:bg-[#252535]'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors duration-100 ${
                        checked.has(r.path) ? 'bg-[#7c3aed] border-[#7c3aed]' : 'border-[#555] bg-transparent'
                      }`}>
                        {checked.has(r.path) && <Check size={10} className="text-white" />}
                      </div>
                      <span className="font-mono text-[12px] text-[#ccc] overflow-hidden text-ellipsis whitespace-nowrap flex-1">
                        {r.path}
                      </span>
                      <span className="text-[10px] text-[#555] shrink-0 tabular-nums">
                        {(r.score * 100).toFixed(0)}%
                      </span>
                      <input
                        type="checkbox"
                        className="hidden"
                        checked={checked.has(r.path)}
                        onChange={() => toggleFile(r.path)}
                      />
                    </label>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {phase === 'results' && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border shrink-0">
            <button
              className="bg-transparent border border-border text-text-faint py-1.5 px-3 rounded-md text-[12px] cursor-pointer transition-colors duration-150 hover:bg-border-subtle hover:text-[#ccc]"
              onClick={handleReprompt}
            >
              Refine search
            </button>
            <div className="flex gap-2">
              <button
                className="bg-transparent border border-border text-text-faint py-1.5 px-3 rounded-md text-[12px] cursor-pointer transition-colors duration-150 hover:bg-border-subtle hover:text-[#ccc]"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                className="bg-[#7c3aed] border-none text-white py-1.5 px-4 rounded-md text-[12px] font-medium cursor-pointer transition-colors duration-150 hover:bg-[#6d28d9] disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleApprove}
                disabled={checked.size === 0}
              >
                Add {checked.size} file{checked.size !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
