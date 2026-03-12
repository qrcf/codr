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

  const statusIcon = tool.status === 'running' ? <Loader2 size={14} className="spin" /> : tool.status === 'error' ? <XCircle size={14} /> : <CheckCircle2 size={14} />

  return (
    <div className={`agent-card ${expanded ? 'agent-card-expanded' : ''}`}>
      <div className="agent-card-header" onClick={() => setExpanded(!expanded)}>
        <span className={`agent-card-status agent-card-status-${tool.status}`}>{statusIcon}</span>
        {subagentType && <span className="agent-card-type">{subagentType}</span>}
        <span className="agent-card-desc">{description}</span>
        <span className="agent-card-chevron">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </div>
      {expanded && result && (
        <div className="agent-card-result">
          <Markdown remarkPlugins={[remarkGfm]}>{result.length > 2000 ? result.slice(0, 2000) + '\n...' : result}</Markdown>
        </div>
      )}
    </div>
  )
}
