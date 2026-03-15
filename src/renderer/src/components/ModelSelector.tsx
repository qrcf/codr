import { useState, useEffect, useRef, useCallback } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { useCodr } from '../hooks/useCodr'

interface ModelOption {
  value: string
  displayName: string
  has1MContext?: boolean
}

interface ModelSelectorProps {
  provider: 'claude' | 'codex'
  selectedModel: string | undefined
  onModelChange: (model: string | undefined) => void
  disabled?: boolean
}

export function ModelSelector({ provider, selectedModel, onModelChange, disabled }: ModelSelectorProps) {
  const codr = useCodr()
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState<ModelOption[]>([])
  const [loading, setLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const fetchModels = useCallback(async (p: 'claude' | 'codex') => {
    setLoading(true)
    try {
      const result = await codr.getModels?.(p)
      if (result?.models) {
        setModels(result.models)
      }
    } catch {
      // Silent failure — models will be empty
    } finally {
      setLoading(false)
    }
  }, [codr])

  // Fetch models when provider changes
  useEffect(() => {
    fetchModels(provider)
  }, [provider, fetchModels])

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
        <div className="absolute bottom-full left-0 mb-1 min-w-45 bg-bg-card border border-border rounded-md py-1 z-10 shadow-[0_4px_12px_rgba(0,0,0,0.4)]">
          {models.map((m) => (
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
        </div>
      )}
    </div>
  )
}
