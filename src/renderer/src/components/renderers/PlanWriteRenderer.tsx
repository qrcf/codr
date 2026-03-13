import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ToolCallInfo } from '../../types'

export function PlanWriteRenderer({ tool }: { tool: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(false)
  const filePath = (tool.input.file_path as string) || ''
  const content = (tool.input.content as string) || ''
  const fileName = filePath.split('/').pop() || 'plan.md'

  return (
    <div className="border border-[#4a4a3a] rounded-lg bg-[#1e1e1a] overflow-hidden my-1">
      <div className="flex items-center gap-2 px-[14px] py-[10px] bg-[#2a2a24] font-semibold text-[#c0a878]">
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#c0a878] text-[#1a1a1a] text-[0.8em] font-bold flex-shrink-0">P</span>
        <span className="font-semibold">Wrote Plan</span>
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
          <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
        </div>
      )}
      {tool.status === 'running' && !content && (
        <div className="px-[14px] py-3 text-[#999] text-[0.9em] italic">Writing plan...</div>
      )}
    </div>
  )
}
