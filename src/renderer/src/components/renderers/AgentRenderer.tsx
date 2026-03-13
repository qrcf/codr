import { Loader2, XCircle, CheckCircle2 } from 'lucide-react'
import type { ToolCallInfo } from '../../types'

export function AgentRenderer({ tool }: { tool: ToolCallInfo }) {
  const description = tool.input.description as string || ''
  const subagentType = tool.input.subagent_type as string | undefined
  const result = tool.result || ''

  const resultPreview = result.length > 500 ? result.slice(0, 500) + '...' : result

  return (
    <div className="border-t border-[#3a3a4a]">
      <div className="flex items-center gap-2 px-[10px] py-[6px] text-[#ccc] text-[0.88em]">
        <span className="flex-shrink-0 w-[18px] text-center">
          {tool.status === 'running' ? <Loader2 size={14} className="animate-spin" /> : tool.status === 'error' ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
        </span>
        {subagentType && <span className="bg-[#3a4a60] text-[#aaccee] px-2 py-[1px] rounded text-[0.82em] font-['SF_Mono','Fira_Code',monospace] flex-shrink-0">{subagentType}</span>}
        <span className="text-[#aaa] overflow-hidden text-ellipsis whitespace-nowrap">{description}</span>
      </div>
      {result && tool.status === 'done' && (
        <pre className="m-0 px-[10px] py-2 bg-[#0d0d1a] font-['SF_Mono','Fira_Code',monospace] text-[0.82em] leading-[1.4] whitespace-pre-wrap break-words text-[#b0b0b0] max-h-[300px] overflow-y-auto border-t border-[#3a3a4a]">{resultPreview}</pre>
      )}
    </div>
  )
}
