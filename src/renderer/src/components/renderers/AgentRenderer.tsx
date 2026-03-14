import { Loader2, XCircle, CheckCircle2 } from 'lucide-react'
import { MarkdownContent } from '../MarkdownContent'
import type { ToolCallInfo } from '../../types'

export function AgentRenderer({ tool }: { tool: ToolCallInfo }) {
  const description = tool.input.description as string || ''
  const subagentType = tool.input.subagent_type as string | undefined
  const prompt = tool.input.prompt as string | undefined
  const isolation = tool.input.isolation as string | undefined
  const runInBackground = tool.input.run_in_background as boolean | undefined
  const result = tool.result || ''

  return (
    <div className="border-t border-[#3a3a4a]">
      {/* Summary row */}
      <div className="flex items-center gap-2 px-[10px] py-[6px] text-[#ccc] text-[0.88em]">
        <span className="flex-shrink-0 w-[18px] text-center">
          {tool.status === 'running' ? <Loader2 size={14} className="animate-spin" /> : tool.status === 'error' ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
        </span>
        {subagentType && <span className="bg-[#3a4a60] text-[#aaccee] px-2 py-[1px] rounded text-[0.82em] font-['SF_Mono','Fira_Code',monospace] flex-shrink-0">{subagentType}</span>}
        <span className="text-[#aaa] overflow-hidden text-ellipsis whitespace-nowrap">{description}</span>
      </div>

      {/* Prompt section */}
      {prompt && (
        <div className="px-[10px] pb-[8px]">
          <div className="text-[0.75em] font-semibold text-[#888] uppercase tracking-[0.05em] mb-1">Prompt</div>
          <div className="message-content" style={{ padding: 8, background: '#0d0d1a', border: '1px solid #3a3a4a', borderRadius: 4, fontSize: '0.88em', lineHeight: 1.5, color: '#b0b0b0', maxHeight: 250, overflowY: 'auto' }}>
            <MarkdownContent>{prompt}</MarkdownContent>
          </div>
          {(isolation || runInBackground) && (
            <div className="flex gap-2 mt-2 flex-wrap">
              {isolation && (
                <span className="bg-[#3a3a20] text-[#ccaa66] px-2 py-[1px] rounded text-[0.78em] font-['SF_Mono','Fira_Code',monospace]">
                  isolation: {isolation}
                </span>
              )}
              {runInBackground && (
                <span className="bg-[#2a3a2a] text-[#88cc88] px-2 py-[1px] rounded text-[0.78em] font-['SF_Mono','Fira_Code',monospace]">
                  background
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Result section */}
      {result && (
        <div className="px-[10px] py-2">
          <div className="text-[0.75em] font-semibold text-[#888] uppercase tracking-[0.05em] mb-1">
            Result{tool.isError ? ' (Error)' : ''}
          </div>
          <div className="message-content" style={{ padding: 8, background: '#0d0d1a', border: '1px solid #3a3a4a', borderRadius: 4, fontSize: '0.88em', lineHeight: 1.5, color: '#b0b0b0', maxHeight: 300, overflowY: 'auto' }}>
            <MarkdownContent>{result}</MarkdownContent>
          </div>
        </div>
      )}
    </div>
  )
}
