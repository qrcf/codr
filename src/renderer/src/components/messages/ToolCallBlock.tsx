import { useState } from 'react'
import { Loader2, XCircle, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react'
import { formatValue } from './formatValue'
import { toolRenderers } from '../renderers/toolRenderers'
import { PlanWriteRenderer } from '../renderers/PlanWriteRenderer'
import type { ToolCallInfo } from '../../types'

/** Build a rawOutput summary (e.g. "156 matches found") for ACP tools with sparse data */
function rawOutputSummary(tool: ToolCallInfo): string {
  if (!tool.rawOutput || typeof tool.rawOutput !== 'object') return ''
  const ro = tool.rawOutput as Record<string, unknown>
  const parts: string[] = []
  if (typeof ro.totalMatches === 'number') parts.push(`${ro.totalMatches} matches`)
  if (typeof ro.totalFiles === 'number') parts.push(`${ro.totalFiles} files`)
  if (ro.truncated === true) parts.push('truncated')
  return parts.join(', ')
}

function getSummary(tool: ToolCallInfo): string {
  // For ACP tools with rawInput but no normalized content, prefer title + rawOutput
  const hasEmptyInput = !tool.input || Object.keys(tool.input).every(k => !tool.input[k])

  if (tool.title && hasEmptyInput) {
    const roSummary = rawOutputSummary(tool)
    const path = tool.locations?.[0]?.path
    const pathPart = path ? ` ${path.split('/').pop() || path}` : ''
    return roSummary ? `${tool.title}${pathPart} — ${roSummary}` : `${tool.title}${pathPart}`
  }

  if (tool.title && !hasEmptyInput) {
    const path = tool.locations?.[0]?.path
    if (path) {
      const fileName = path.split('/').pop() || path
      return `${tool.title} ${fileName}`
    }
  }

  switch (tool.kind) {
    case 'Bash':
      return (tool.input.command as string)?.slice(0, 80) || tool.title || ''
    case 'Read': {
      const fp = (tool.input.file_path as string) || tool.locations?.[0]?.path || ''
      const lineCount = tool.result?.split('\n').length
      return (fp || tool.title || '') + (tool.status === 'done' && lineCount ? ` (${lineCount} lines)` : '')
    }
    case 'Edit':
    case 'Write':
      return (tool.input.file_path as string) || tool.locations?.[0]?.path || tool.title || ''
    case 'Grep': {
      const grepPattern = (tool.input.pattern as string) || ''
      if (grepPattern) {
        const matches = tool.result?.split('\n').filter(Boolean) || []
        return grepPattern + (tool.status === 'done' && matches.length > 0 ? ` (${matches.length} matches)` : '')
      }
      // ACP fallback: no pattern available, show title + rawOutput
      const roSummary = rawOutputSummary(tool)
      return roSummary ? `${tool.title || 'grep'} — ${roSummary}` : (tool.title || 'grep')
    }
    case 'Glob': {
      const globPattern = (tool.input.pattern as string) || ''
      if (globPattern) {
        const files = tool.result?.split('\n').filter(Boolean) || []
        return globPattern + (tool.status === 'done' && files.length > 0 ? ` (${files.length} files)` : '')
      }
      const roSummary = rawOutputSummary(tool)
      return roSummary ? `${tool.title || 'glob'} — ${roSummary}` : (tool.title || 'glob')
    }
    case 'TodoWrite':
      return `${(tool.input.todos as unknown[])?.length || 0} tasks`
    case 'Agent':
      return (tool.input.description as string) || tool.title || ''
    case 'EnterPlanMode':
    case 'ExitPlanMode':
      return 'plan ready for review'
    case 'AskUserQuestion': {
      const questions = (tool.input.questions as Array<{ header: string }>) || []
      return questions.map((q) => q.header).join(', ') || 'question'
    }
    case 'WebFetch':
      return (tool.input.url as string) || tool.title || ''
    case 'WebSearch':
      return (tool.input.query as string) || tool.title || ''
    default: {
      // Fallback: try common fields, then title
      const fromInput = (tool.input.command as string)?.slice(0, 80)
        || (tool.input.file_path as string)
        || (tool.input.pattern as string)
        || tool.locations?.[0]?.path
      if (fromInput) return fromInput
      const roSummary = rawOutputSummary(tool)
      return roSummary ? `${tool.title || tool.kind} — ${roSummary}` : (tool.title || '')
    }
  }
}

export function ToolCallBlock({ tool }: { tool: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(false)
  const [showRawDetails, setShowRawDetails] = useState(false)
  const isPlanWrite = (tool.kind === 'Edit' || tool.kind === 'Write') && (tool.input.file_path as string)?.includes('.claude/plans/')

  const Renderer = isPlanWrite ? PlanWriteRenderer : toolRenderers[tool.kind]
  const hasRenderer = !!Renderer

  const summary = getSummary(tool)
  const statusColor = tool.status === 'running' ? 'text-[#f0c040]' : tool.status === 'error' ? 'text-[#f44336]' : 'text-[#4caf50]'
  const statusIcon = tool.status === 'running' ? <Loader2 size={14} className="animate-spin" /> : tool.status === 'error' ? <XCircle size={14} /> : <CheckCircle2 size={14} />

  return (
    <div className={`border rounded overflow-hidden text-[0.9em] max-[768px]:text-[0.8em] ${expanded ? 'border-[#3a3a4a] my-1' : 'border-transparent'}`}>
      <div className={`flex items-center gap-2 px-2.5 py-1 bg-border-subtle cursor-pointer select-none hover:bg-[#333345] ${expanded ? 'rounded-t' : 'rounded'}`} onClick={() => setExpanded(!expanded)}>
        <span className={`text-[0.85em] w-4.5 text-center shrink-0 ${statusColor}`}>{statusIcon}</span>
        <span className="bg-[#444460] text-[#ccc] px-2 py-px rounded text-[0.85em] font-['SF_Mono','Fira_Code',monospace] shrink-0">{tool.kind}</span>
        {summary && <span className="text-text-muted overflow-hidden text-ellipsis whitespace-nowrap flex-1 font-['SF_Mono','Fira_Code',monospace] text-[0.85em]">{summary}</span>}
        <span className="text-text-dim shrink-0 text-[0.8em]">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </div>
      {expanded && (
        <>
          {hasRenderer && <Renderer tool={tool} />}
          {hasRenderer && (
            <span
              className="inline-block px-2.5 py-0.5 text-[0.75em] text-text-dim cursor-pointer select-none font-['SF_Mono','Fira_Code',monospace] hover:text-text-muted hover:underline"
              onClick={() => setShowRawDetails(!showRawDetails)}
            >
              {showRawDetails ? 'less' : 'more details'}
            </span>
          )}
          {(!hasRenderer || showRawDetails) && (
            <div className="p-2.5 border-t border-[#3a3a4a] bg-bg-tertiary max-[768px]:text-[0.85em]">
              <div className="mb-2">
                <div className="text-[0.75em] font-semibold text-text-faint uppercase tracking-[0.05em] mb-1">Input</div>
                {formatValue(tool.input)}
              </div>
              {tool.result !== undefined && (
                <div>
                  <div className="text-[0.75em] font-semibold text-text-faint uppercase tracking-[0.05em] mb-1">Result{tool.isError ? ' (Error)' : ''}</div>
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
