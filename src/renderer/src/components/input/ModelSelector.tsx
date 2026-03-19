import { useState, useEffect, useRef } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { useCodr } from '../../hooks/useCodr'

interface ModelOption {
  value: string
  displayName: string
  has1MContext?: boolean
}

interface ModelSelectorProps {
  provider: AgentProviderId
  selectedModel: string | undefined
  onModelChange: (model: string | undefined) => void
  disabled?: boolean
}

export function ModelSelector({ provider, selectedModel, onModelChange, disabled }: ModelSelectorProps) {
  const codr = useCodr()
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState<ModelOption[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Fetch models when provider changes — cancel stale in-flight fetches
  useEffect(() => {
    let cancelled = false
    const fetchModels = async () => {
      try {
        const result = await codr.getModels?.(provider)
        if (!cancelled && result?.models) setModels(result.models)
      } catch { /* ignore */ } finally {
        if (!cancelled) setLoading(false)
      }
    }
    setModels([])
    setLoading(true)
    // Defer state-dependent fetch to avoid synchronous setState in effect
    void fetchModels()
    return () => { cancelled = true }
  }, [provider, codr])

  // Auto-refresh when cursor/ACP connects and model-selection capability becomes available
  useEffect(() => {
    return codr.onCapabilitiesChanged?.((data) => {
      if (data.providerId === provider && data.capabilities.includes('model-selection')) {
        codr.getModels?.(provider)
          .then(result => { if (result?.models.length) setModels(result.models) })
          .catch(() => {})
      }
    })
  }, [provider, codr])

  // Auto-focus search when dropdown opens with many models
  useEffect(() => {
    if (open && models.length > 4) {
      searchRef.current?.focus()
    }
  }, [open, models.length])

  // Clear search when dropdown closes
  useEffect(() => {
    if (!open) {
      // Use microtask to avoid synchronous setState in effect body
      queueMicrotask(() => setSearchQuery(''))
    }
  }, [open])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Resolve selectedModel to a matching option.
  // selectedModel can be an SDK alias ("sonnet") or a full API ID ("claude-sonnet-4-6-20250514")
  const resolveModel = (id: string | undefined) => {
    if (!id) return undefined
    // Exact match first (SDK alias)
    const exact = models.find(m => m.value === id)
    if (exact) return exact
    // Fuzzy: full API ID contains the SDK family name (e.g. "claude-sonnet-4-6..." matches "sonnet")
    return models.find(m => {
      const family = m.value.replace(/\[.*]$/, '')
      return id.includes(family)
    })
  }
  const currentModel = resolveModel(selectedModel)
  const displayLabel = currentModel?.displayName || (loading ? '...' : 'Model')
  const filteredModels = searchQuery
    ? models.filter(m =>
        m.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.value.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : models

  if (models.length === 0 && !loading) return null

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        className={`inline-flex items-center gap-1 rounded-md px-2.5 py-0.75 text-[0.78rem] cursor-pointer transition-all duration-150 bg-transparent border-none hover:text-[#bbb] hover:bg-white/4 max-[768px]:text-[0.75em] max-[768px]:py-1 ${open ? 'text-accent' : 'text-text-faint'}`}
        onClick={() => setOpen(prev => !prev)}
        disabled={disabled || loading}
        title="Select model"
      >
        <span className="max-w-30 truncate">{displayLabel}</span>
        <ChevronDown size={12} className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 min-w-45 bg-bg-card border border-border rounded-md z-10 shadow-[0_4px_12px_rgba(0,0,0,0.4)]">
          {models.length > 4 && (
            <div className="px-2 pt-1.5 pb-1 border-b border-border">
              <input
                ref={searchRef}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search models..."
                className="w-full bg-transparent text-[0.82em] text-text-primary placeholder:text-text-faint outline-none px-1"
              />
            </div>
          )}
          <div className="max-h-52 overflow-y-auto py-1">
            {filteredModels.map((m) => (
              <button
                key={m.value}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-[0.82em] bg-transparent border-none cursor-pointer hover:bg-[#2a2a3e] text-left ${currentModel?.value === m.value ? 'text-accent' : 'text-[#ccc] hover:text-white'}`}
                onClick={() => {
                  onModelChange(m.value)
                  setOpen(false)
                }}
              >
                <span className="w-3 shrink-0">
                  {currentModel?.value === m.value && <Check size={12} />}
                </span>
                <span>{m.displayName}</span>
                {m.has1MContext && <span className="text-[0.7em] px-1 py-px rounded bg-border text-text-muted leading-none">1M</span>}
              </button>
            ))}
            {filteredModels.length === 0 && (
              <div className="px-3 py-2 text-[0.82em] text-text-faint text-center">No matches</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
