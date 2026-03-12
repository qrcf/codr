import { Loader2, XCircle, CheckCircle2 } from 'lucide-react'
import type { ToolCallInfo } from '../../types'

export function AgentRenderer({ tool }: { tool: ToolCallInfo }) {
  const description = tool.input.description as string || ''
  const subagentType = tool.input.subagent_type as string | undefined
  const result = tool.result || ''

  const resultPreview = result.length > 500 ? result.slice(0, 500) + '...' : result

  return (
    <div className="agent-renderer">
      <div className="agent-header">
        <span className="agent-icon">
          {tool.status === 'running' ? <Loader2 size={14} className="spin" /> : tool.status === 'error' ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
        </span>
        {subagentType && <span className="agent-type-badge">{subagentType}</span>}
        <span className="agent-description">{description}</span>
      </div>
      {result && tool.status === 'done' && (
        <pre className="agent-result">{resultPreview}</pre>
      )}
    </div>
  )
}
