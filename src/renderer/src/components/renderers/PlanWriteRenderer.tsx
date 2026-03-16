import { useState } from 'react'
import { Check } from 'lucide-react'
import { MarkdownContent } from '../messages/MarkdownContent'
import type { ToolCallInfo } from '../../types'

interface PlanWriteRendererProps {
  tool: ToolCallInfo
  isApproved?: boolean
}

export function PlanWriteRenderer({ tool, isApproved }: PlanWriteRendererProps) {
  const [expanded, setExpanded] = useState(false)
  const filePath = (tool.input.file_path as string) || ''
  const content = (tool.input.content as string) || ''
  const fileName = filePath.split('/').pop() || 'plan.md'

  const borderColor = isApproved ? 'border-[#3a4a4a]' : 'border-[#4a4a3a]'
  const bgColor = isApproved ? 'bg-[#1a1e1e]' : 'bg-[#1e1e1a]'
  const headerBg = isApproved ? 'bg-[#242a2a]' : 'bg-[#2a2a24]'
  const accentColor = isApproved ? 'text-[#78c0a8]' : 'text-[#c0a878]'
  const badgeBg = isApproved ? 'bg-[#78c0a8]' : 'bg-[#c0a878]'

  return (
    <div className={`border ${borderColor} rounded-lg ${bgColor} overflow-hidden my-1`}>
      <div className={`flex items-center gap-2 px-[14px] py-[10px] ${headerBg} font-semibold ${accentColor}`}>
        <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full ${badgeBg} text-[#1a1a1a] text-[0.8em] font-bold flex-shrink-0`}>P</span>
        <span className="font-semibold">{isApproved ? 'Plan' : 'Wrote Plan'}</span>
        {isApproved && <Check size={14} className="text-[#78c0a8]" />}
        <span className="font-['SF_Mono','Fira_Code',monospace] text-[0.85em] text-[#999] font-normal">{fileName}</span>
        <button
          className="ml-auto bg-none border border-[#4a4a3a] text-[#999] rounded px-2 py-[2px] text-[0.75em] cursor-pointer hover:bg-[#3a3a30] hover:text-[#ccc]"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
      {expanded && content && (
        <div className="plan-review-content">
          <MarkdownContent>{content}</MarkdownContent>
        </div>
      )}
      {tool.status === 'running' && !content && (
        <div className="px-[14px] py-3 text-[#999] text-[0.9em] italic">Writing plan...</div>
      )}
    </div>
  )
}
