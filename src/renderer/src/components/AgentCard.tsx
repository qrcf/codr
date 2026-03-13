import { useState } from 'react'
import { Loader2, XCircle, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ToolCallInfo } from '../types'

export function AgentCard({ tool }: { tool: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(tool.status === 'running')
  const description = (tool.input.description as string) || 'Agent'
  const subagentType = tool.input.subagent_type as string | undefined
  const result = tool.result || ''

  const statusIcon = tool.status === 'running' ? <Loader2 size={14} className="animate-spin" /> : tool.status === 'error' ? <XCircle size={14} /> : <CheckCircle2 size={14} />
  const statusColor = tool.status === 'running' ? 'text-[#f0c040]' : tool.status === 'done' ? 'text-[#6cb8ff]' : 'text-[#f44336]'

  return (
    <div className="border border-[#3a4a5a] rounded-md my-[6px] overflow-hidden text-[0.9em]">
      <div
        className="flex items-center gap-2 px-[10px] py-[6px] bg-[#1e2a3a] cursor-pointer select-none hover:bg-[#253545]"
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`flex-shrink-0 w-4 text-center text-[0.85em] ${statusColor}`}>{statusIcon}</span>
        {subagentType && <span className="bg-[#3a4a60] text-[#aaccee] px-2 py-[1px] rounded text-[0.82em] font-['SF_Mono','Fira_Code',monospace] flex-shrink-0">{subagentType}</span>}
        <span className="text-[#ccc] overflow-hidden text-ellipsis whitespace-nowrap flex-1">{description}</span>
        <span className="text-[#666] flex-shrink-0 text-[0.8em]">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </div>
      {expanded && result && (
        <div className="px-3 py-2 border-t border-[#3a4a5a] bg-[#141e2a] text-[0.9em] leading-[1.5] text-[#b0b0b0] max-h-[400px] overflow-y-auto [&_p]:mb-[6px] [&_p:last-child]:mb-0 [&_code]:bg-[#2a2a3a] [&_code]:px-1 [&_code]:rounded-[3px] [&_code]:font-['SF_Mono','Fira_Code',monospace] [&_code]:text-[0.9em]">
          <Markdown remarkPlugins={[remarkGfm]}>{result.length > 2000 ? result.slice(0, 2000) + '\n...' : result}</Markdown>
        </div>
      )}
    </div>
  )
}
