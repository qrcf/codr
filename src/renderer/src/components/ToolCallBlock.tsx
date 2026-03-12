import { useState } from 'react'
import { Loader2, XCircle, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react'
import { formatValue } from './JsonHighlight'
import { toolRenderers } from './toolRenderers'
import { PlanWriteRenderer } from './renderers/PlanWriteRenderer'
import type { ToolCallInfo } from '../types'

function getSummary(tool: ToolCallInfo): string {
  switch (tool.name) {
    case 'Bash':
      return (tool.input.command as string)?.slice(0, 80) || ''
    case 'Read': {
      const fp = (tool.input.file_path as string) || ''
      const lineCount = tool.result?.split('\n').length
      return fp + (tool.status === 'done' && lineCount ? ` (${lineCount} lines)` : '')
    }
    case 'Edit':
    case 'Write':
      return (tool.input.file_path as string) || ''
    case 'Grep': {
      const grepPattern = (tool.input.pattern as string) || ''
      const matches = tool.result?.split('\n').filter(Boolean) || []
      return grepPattern + (tool.status === 'done' && matches.length > 0 ? ` (${matches.length} matches)` : '')
    }
    case 'Glob': {
      const globPattern = (tool.input.pattern as string) || ''
      const files = tool.result?.split('\n').filter(Boolean) || []
      return globPattern + (tool.status === 'done' && files.length > 0 ? ` (${files.length} files)` : '')
    }
    case 'TodoWrite':
      return `${(tool.input.todos as unknown[])?.length || 0} tasks`
    case 'Agent':
      return (tool.input.description as string) || ''
    case 'EnterPlanMode':
      return 'entered plan mode'
    case 'ExitPlanMode':
      return 'plan ready for review'
    case 'AskUserQuestion': {
      const questions = (tool.input.questions as Array<{ header: string }>) || []
      return questions.map((q) => q.header).join(', ') || 'question'
    }
    default:
      return ''
  }
}

export function ToolCallBlock({ tool }: { tool: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(false)
  const [showRawDetails, setShowRawDetails] = useState(false)
  const isPlanWrite = tool.name === 'Write' && (tool.input.file_path as string)?.includes('.claude/plans/')
  const CustomRenderer = isPlanWrite ? PlanWriteRenderer : toolRenderers[tool.name]
  const hasRenderer = !!CustomRenderer
  const summary = getSummary(tool)

  const statusIcon = tool.status === 'running' ? <Loader2 size={14} className="spin" /> : tool.status === 'error' ? <XCircle size={14} /> : <CheckCircle2 size={14} />
  const statusClass = `tool-status tool-status-${tool.status}`

  return (
    <div className={`tool-call-block ${expanded ? 'tool-call-expanded' : ''}`}>
      <div className="tool-call-header" onClick={() => setExpanded(!expanded)}>
        <span className={statusClass}>{statusIcon}</span>
        <span className="tool-name-badge">{tool.name}</span>
        {summary && <span className="tool-summary">{summary}</span>}
        <span className="tool-chevron">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </div>
      {expanded && (
        <>
          {CustomRenderer && <CustomRenderer tool={tool} />}
          {hasRenderer && (
            <span
              className="tool-raw-toggle"
              onClick={() => setShowRawDetails(!showRawDetails)}
            >
              {showRawDetails ? 'less' : 'more details'}
            </span>
          )}
          {(!hasRenderer || showRawDetails) && (
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
        </>
      )}
    </div>
  )
}
