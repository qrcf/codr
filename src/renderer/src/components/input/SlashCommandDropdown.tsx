import { useEffect, useRef } from 'react'
import { Terminal } from 'lucide-react'

interface SlashCommandDropdownProps {
  commands: SlashCommand[]
  activeIndex: number
  onSelect: (cmd: SlashCommand) => void
}

export function SlashCommandDropdown({ commands, activeIndex, onSelect }: SlashCommandDropdownProps) {
  const activeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const dropdownClass = "absolute bottom-full left-0 right-0 mb-1 bg-[#1e1e2e] border border-[#444] rounded-lg max-h-60 overflow-y-auto z-[100] shadow-[0_-4px_16px_rgba(0,0,0,0.4)]"
  const headerClass = "px-3 py-1.5 text-[0.75em] text-[#888] uppercase tracking-[0.05em] border-b border-[#333]"
  const itemBase = "px-3 py-1.5 cursor-pointer text-[0.85em] text-[#ccc] flex items-center gap-2 hover:bg-[#2a2a3d] hover:text-white"
  const itemActive = "bg-[#2a2a3d] text-white"

  if (commands.length === 0) {
    return (
      <div className={dropdownClass}>
        <div className="p-3 text-text-dim text-[0.85em] text-center">No matching commands</div>
      </div>
    )
  }

  return (
    <div className={dropdownClass}>
      <div className={headerClass}>Commands</div>
      {commands.map((cmd, i) => (
        <div
          key={cmd.name}
          ref={i === activeIndex ? activeRef : undefined}
          className={`${itemBase}${i === activeIndex ? ` ${itemActive}` : ''}`}
          onMouseDown={(e) => {
            e.preventDefault()
            onSelect(cmd)
          }}
        >
          <Terminal size={12} className="shrink-0 opacity-60" />
          <span className="font-mono font-medium">/{cmd.name}</span>
          <span className="ml-2 text-[11px] opacity-50 overflow-hidden text-ellipsis whitespace-nowrap">{cmd.description}</span>
        </div>
      ))}
    </div>
  )
}
