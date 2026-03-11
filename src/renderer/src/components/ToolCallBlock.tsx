import { useState } from 'react'
import { formatValue } from './JsonHighlight'
import type { ToolCallInfo } from '../types'

export function ToolCallBlock({ tool }: { tool: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(false)

  const summary = tool.name === 'Bash'
    ? (tool.input.command as string)?.slice(0, 80) || ''
    : tool.name === 'Read'
      ? (tool.input.file_path as string) || ''
      : tool.name === 'Edit' || tool.name === 'Write'
        ? (tool.input.file_path as string) || ''
        : tool.name === 'Grep'
          ? (tool.input.pattern as string) || ''
          : tool.name === 'Glob'
            ? (tool.input.pattern as string) || ''
            : ''

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
