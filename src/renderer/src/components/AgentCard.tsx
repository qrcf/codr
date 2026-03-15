import { useState } from 'react'
import { Loader2, XCircle, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react'
import { MarkdownContent } from './MarkdownContent'
import type { ToolCallInfo } from '../types'

export function AgentCard({ tool }: { tool: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(tool.status === 'running')
  const description = (tool.input.description as string) || 'Agent'
  const subagentType = tool.input.subagent_type as string | undefined
  const prompt = tool.input.prompt as string | undefined
  const isolation = tool.input.isolation as string | undefined
  const runInBackground = tool.input.run_in_background as boolean | undefined
  const result = tool.result || ''

  const statusIcon = tool.status === 'running' ? <Loader2 size={14} className="animate-spin" /> : tool.status === 'error' ? <XCircle size={14} /> : <CheckCircle2 size={14} />
  const statusColor = tool.status === 'running' ? 'text-[#f0c040]' : tool.status === 'done' ? 'text-[#6cb8ff]' : 'text-[#f44336]'

  return (
    <div className="border border-[#3a4a5a] rounded-md my-1.5 overflow-hidden text-[0.9em]">
      <div
        className="flex items-center gap-2 px-2.5 py-1.5 bg-[#1e2a3a] cursor-pointer select-none hover:bg-[#253545]"
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`shrink-0 w-4 text-center text-[0.85em] ${statusColor}`}>{statusIcon}</span>
        {subagentType && <span className="bg-[#3a4a60] text-[#aaccee] px-2 py-px rounded text-[0.82em] font-['SF_Mono','Fira_Code',monospace] shrink-0">{subagentType}</span>}
        <span className="text-[#ccc] overflow-hidden text-ellipsis whitespace-nowrap flex-1">{description}</span>
        {(isolation || runInBackground) && (
          <div className="flex gap-1 shrink-0">
            {isolation && <span className="bg-[#3a3a20] text-[#ccaa66] px-1.5 py-px rounded text-[0.78em] font-['SF_Mono','Fira_Code',monospace]">{isolation}</span>}
            {runInBackground && <span className="bg-[#2a3a2a] text-[#88cc88] px-1.5 py-px rounded text-[0.78em] font-['SF_Mono','Fira_Code',monospace]">bg</span>}
          </div>
        )}
        <span className="text-text-dim shrink-0 text-[0.8em]">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </div>
      {expanded && (
        <>
          {prompt && (
            <div className="px-3 py-2 border-t border-[#3a4a5a] bg-[#141e2a]">
              <div className="text-[0.75em] font-semibold text-text-faint uppercase tracking-[0.05em] mb-1">Prompt</div>
              <div className="message-content text-[0.9em] leading-normal text-[#b0b0b0] max-h-62.5 overflow-y-auto bg-[#0d0d1a] border border-[#3a3a4a] rounded p-2 [&_p]:mb-1.5 [&_p:last-child]:mb-0 [&_code]:bg-border-subtle [&_code]:px-1 [&_code]:rounded-[3px] [&_code]:font-['SF_Mono','Fira_Code',monospace] [&_code]:text-[0.9em]">
                <MarkdownContent>{prompt}</MarkdownContent>
              </div>
            </div>
          )}
          {result && (
            <div className="px-3 py-2 border-t border-[#3a4a5a] bg-[#141e2a]">
              <div className="text-[0.75em] font-semibold text-text-faint uppercase tracking-[0.05em] mb-1">Result{tool.isError ? ' (Error)' : ''}</div>
              <div className="message-content text-[0.9em] leading-normal text-[#b0b0b0] max-h-100 overflow-y-auto bg-[#0d0d1a] border border-[#3a3a4a] rounded p-2 [&_p]:mb-1.5 [&_p:last-child]:mb-0 [&_code]:bg-border-subtle [&_code]:px-1 [&_code]:rounded-[3px] [&_code]:font-['SF_Mono','Fira_Code',monospace] [&_code]:text-[0.9em]">
                <MarkdownContent>{result}</MarkdownContent>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
