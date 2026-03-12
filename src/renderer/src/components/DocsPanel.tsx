import { useState, useEffect } from 'react'
import { X, RefreshCw, Trash2, Loader2, BookOpen, Plus, ExternalLink } from 'lucide-react'

interface DocsPanelProps {
  sources: DocSource[]
  onAddSource: (url: string, name: string, crawlDepth?: number) => Promise<void>
  onDeleteSource: (sourceId: number) => Promise<void>
  onRecrawlSource: (sourceId: number, url: string, crawlDepth: number) => Promise<void>
  onRefresh: () => void
  onClose: () => void
}

export function DocsPanel({ sources, onAddSource, onDeleteSource, onRecrawlSource, onRefresh, onClose }: DocsPanelProps) {
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [crawlDepth, setCrawlDepth] = useState(3)
  const [isAdding, setIsAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Listen for crawl progress updates
  useEffect(() => {
    const cleanup = window.claude.onDocsCrawlProgress?.((progress) => {
      if (progress.status === 'complete' || progress.status === 'error') {
        onRefresh()
      }
    })
    return cleanup
  }, [onRefresh])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim() || !name.trim()) return

    setIsAdding(true)
    setError(null)
    try {
      await onAddSource(url.trim(), name.trim(), crawlDepth)
      setUrl('')
      setName('')
      setCrawlDepth(3)
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add doc source')
    } finally {
      setIsAdding(false)
    }
  }

  const handleDelete = async (sourceId: number) => {
    try {
      await onDeleteSource(sourceId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  const handleRecrawl = async (source: DocSource) => {
    try {
      await onRecrawlSource(source.id, source.url, source.crawlDepth)
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to recrawl')
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ready':
        return <span className="docs-status-badge docs-status-ready">Ready</span>
      case 'crawling':
        return <span className="docs-status-badge docs-status-crawling"><Loader2 size={12} className="spin" /> Crawling</span>
      case 'error':
        return <span className="docs-status-badge docs-status-error">Error</span>
      case 'pending':
        return <span className="docs-status-badge docs-status-pending">Pending</span>
      default:
        return <span className="docs-status-badge">{status}</span>
    }
  }

  return (
    <div className="manage-project-panel">
      <div className="manage-project-topbar">
        <div className="manage-project-topbar-left">
          <BookOpen size={18} />
          <span className="manage-project-title">Documentation</span>
        </div>
        <button className="manage-project-close" onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      <div className="manage-project-body" style={{ padding: '20px' }}>
        {/* Add source form */}
        <form onSubmit={handleAdd} className="docs-add-form">
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 600 }}>Add Documentation</h3>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <input
              type="url"
              placeholder="https://docs.example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              style={{ flex: 2, padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color, #333)', background: 'var(--input-bg, #1a1a1a)', color: 'inherit', fontSize: '13px' }}
            />
            <input
              type="text"
              placeholder="Display name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              style={{ flex: 1, padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color, #333)', background: 'var(--input-bg, #1a1a1a)', color: 'inherit', fontSize: '13px' }}
            />
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <label style={{ fontSize: '12px', color: 'var(--text-muted, #888)' }}>
              Crawl depth:
              <select
                value={crawlDepth}
                onChange={(e) => setCrawlDepth(parseInt(e.target.value))}
                style={{ marginLeft: '6px', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color, #333)', background: 'var(--input-bg, #1a1a1a)', color: 'inherit', fontSize: '12px' }}
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
              disabled={isAdding || !url.trim() || !name.trim()}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: 'none',
                background: 'var(--accent-color, #4a9eff)',
                color: '#fff',
                fontSize: '13px',
                fontWeight: 500,
                cursor: isAdding ? 'wait' : 'pointer',
                opacity: isAdding || !url.trim() || !name.trim() ? 0.5 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {isAdding ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
              Add
            </button>
          </div>
        </form>

        {error && (
          <div style={{ margin: '12px 0', padding: '8px 12px', borderRadius: '6px', background: 'rgba(255,80,80,0.1)', border: '1px solid rgba(255,80,80,0.3)', color: '#ff5050', fontSize: '13px' }}>
            {error}
          </div>
        )}

        {/* Source list */}
        <div style={{ marginTop: '24px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 600 }}>
            Indexed Sources {sources.length > 0 && <span style={{ fontWeight: 400, color: 'var(--text-muted, #888)' }}>({sources.length})</span>}
          </h3>

          {sources.length === 0 ? (
            <p style={{ color: 'var(--text-muted, #888)', fontSize: '13px', textAlign: 'center', padding: '32px 0' }}>
              No documentation sources indexed yet. Add a URL above to get started.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {sources.map((source) => (
                <div
                  key={source.id}
                  style={{
                    padding: '12px 16px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color, #333)',
                    background: 'var(--card-bg, #1a1a1a)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <BookOpen size={14} />
                      <span style={{ fontWeight: 600, fontSize: '14px' }}>{source.name}</span>
                      {getStatusBadge(source.status)}
                    </div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button
                        onClick={() => handleRecrawl(source)}
                        disabled={source.status === 'crawling'}
                        title="Re-crawl"
                        style={{ padding: '4px', borderRadius: '4px', border: 'none', background: 'transparent', color: 'var(--text-muted, #888)', cursor: 'pointer' }}
                      >
                        <RefreshCw size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(source.id)}
                        title="Delete"
                        style={{ padding: '4px', borderRadius: '4px', border: 'none', background: 'transparent', color: 'var(--text-muted, #888)', cursor: 'pointer' }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px', color: 'var(--text-muted, #888)' }}>
                    <a href={source.url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '3px' }}>
                      {source.url} <ExternalLink size={10} />
                    </a>
                    {source.pageCount > 0 && <span>{source.pageCount} pages</span>}
                    {source.lastCrawledAt && <span>Last crawled: {new Date(source.lastCrawledAt).toLocaleDateString()}</span>}
                  </div>
                  {source.status === 'error' && source.errorMessage && (
                    <div style={{ marginTop: '6px', fontSize: '12px', color: '#ff5050' }}>
                      Error: {source.errorMessage}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
