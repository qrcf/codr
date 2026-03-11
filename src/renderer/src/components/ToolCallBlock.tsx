import { useState } from 'react'
import { formatValue } from './JsonHighlight'
import { toolRenderers } from './toolRenderers'
import type { ToolCallInfo } from '../types'

function getSummary(tool: ToolCallInfo): string {
  switch (tool.name) {
    case 'Bash':
      return (tool.input.command as string)?.slice(0, 80) || ''
    case 'Read':
      return (tool.input.file_path as string) || ''
    case 'Edit':
    case 'Write':
      return (tool.input.file_path as string) || ''
    case 'Grep':
      return (tool.input.pattern as string) || ''
    case 'Glob':
      return (tool.input.pattern as string) || ''
    case 'TodoWrite':
      return `${(tool.input.todos as unknown[])?.length || 0} tasks`
    case 'Agent':
      return (tool.input.description as string) || ''
    default:
      return ''
  }
}

export function ToolCallBlock({ tool }: { tool: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(false)
  const CustomRenderer = toolRenderers[tool.name]
  const summary = getSummary(tool)

  const statusIcon = tool.status === 'running' ? '⟳' : tool.status === 'error' ? '✗' : '✓'
  const statusClass = `tool-status tool-status-${tool.status}`

  return (
    <div className="tool-call-block">
      <div className="tool-call-header" onClick={() => setExpanded(!expanded)}>
        <span className={statusClass}>{statusIcon}</span>
        <span className="tool-name-badge">{tool.name}</span>
        {summary && <span className="tool-summary">{summary}</span>}
        <span className="tool-chevron">{expanded ? '▾' : '▸'}</span>
      </div>
      {CustomRenderer && <CustomRenderer tool={tool} />}
      {expanded && (
        <div className="tool-call-details">
          <div className="tool-section">
            <div className="tool-section-label">Input</div>
            {formatValue(tool.input)}
          </div>
          {tool.result !== undefined && (
            <div className="tool-section">
              <div className="tool-section-label">Result{tool.isError ? ' (Error)' : ''}</div>
              {formatValue(tool.result)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
