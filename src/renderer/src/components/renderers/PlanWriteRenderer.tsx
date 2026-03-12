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
    <div className="plan-write-renderer">
      <div className="plan-write-header">
        <span className="plan-mode-icon">P</span>
        <span className="plan-write-title">Wrote Plan</span>
        <span className="plan-write-file">{fileName}</span>
        <button className="plan-write-expand" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
      {expanded && content && (
        <div className="plan-review-content expanded">
          <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
        </div>
      )}
      {tool.status === 'running' && !content && (
        <div className="plan-write-loading">Writing plan...</div>
      )}
    </div>
  )
}
