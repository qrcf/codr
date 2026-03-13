import { useState, useEffect, useRef } from 'react'
import { ChevronDown } from 'lucide-react'

export type ReasoningLevel = 'auto' | 'low' | 'medium' | 'high'

const LEVELS: { value: ReasoningLevel; label: string; description: string }[] = [
  { value: 'auto', label: 'Auto', description: 'No extended thinking' },
  { value: 'low', label: 'Low', description: '~3k thinking tokens' },
  { value: 'medium', label: 'Medium', description: '~8k thinking tokens' },
  { value: 'high', label: 'High', description: '~20k thinking tokens' },
]

interface ReasoningSelectorProps {
  value: ReasoningLevel
  onChange: (level: ReasoningLevel) => void
  disabled?: boolean
}

export function ReasoningSelector({ value, onChange, disabled }: ReasoningSelectorProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const current = LEVELS.find(l => l.value === value) ?? LEVELS[0]
  const isActive = value !== 'auto'

  return (
    <div className="relative" ref={ref}>
      <button
        className={`inline-flex items-center gap-1 rounded-md px-[10px] py-[3px] text-[0.78rem] cursor-pointer transition-all duration-150 bg-transparent border-none max-[768px]:text-[0.75em] max-[768px]:py-1 ${
          open || isActive
            ? 'text-[#8142c7] hover:bg-white/[0.04]'
            : 'text-[#888] hover:text-[#bbb] hover:bg-white/[0.04]'
        }`}
        onClick={() => setOpen(prev => !prev)}
        disabled={disabled}
        title="Reasoning effort"
      >
        <span>{current.label}</span>
        <ChevronDown size={12} className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 min-w-[170px] bg-[#1e1e2e] border border-[#333] rounded-md py-1 z-10 shadow-[0_4px_12px_rgba(0,0,0,0.4)]">
          {LEVELS.map(l => (
            <button
              key={l.value}
              className={`w-full flex flex-col px-3 py-[6px] text-left bg-transparent border-none cursor-pointer hover:bg-[#2a2a3e] ${
                value === l.value ? 'text-[#8142c7]' : 'text-[#ccc] hover:text-white'
              }`}
              onClick={() => { onChange(l.value); setOpen(false) }}
            >
              <span className="text-[0.82em]">{l.label}</span>
              <span className="text-[0.7em] opacity-50">{l.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
