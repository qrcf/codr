import { useEffect } from 'react'
import { X } from 'lucide-react'
import { MarkdownContent } from '../messages/MarkdownContent'

interface PlanOverlayProps {
  plan: { content: string; filePath: string }
  onClose: () => void
}

export function PlanOverlay({ plan, onClose }: PlanOverlayProps) {
  const fileName = plan.filePath.split('/').pop() || 'plan.md'

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="absolute inset-0 z-50 bg-[#1a1a2e] flex flex-col">
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border shrink-0">
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#78c0a8] text-[#1a1a1a] text-[0.8em] font-bold shrink-0">P</span>
        <span className="text-[#78c0a8] font-semibold text-[0.9em]">Approved Plan</span>
        <span className="font-['SF_Mono','Fira_Code',monospace] text-[0.75em] text-text-dim">{fileName}</span>
        <button
          className="ml-auto bg-transparent border border-[#444] rounded text-[#aaa] w-7 h-7 flex items-center justify-center cursor-pointer p-0 shrink-0 transition-[background] duration-150 hover:bg-border-subtle hover:text-[#ddd]"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="max-w-205 w-full mx-auto">
          <div className="plan-review-content">
            <MarkdownContent>{plan.content}</MarkdownContent>
          </div>
        </div>
      </div>
    </div>
  )
}
