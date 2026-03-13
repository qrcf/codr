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

  const statusColor = tool.status === 'running' ? 'text-[#f0c040]' : tool.status === 'error' ? 'text-[#f44336]' : 'text-[#4caf50]'
  const statusIcon = tool.status === 'running' ? <Loader2 size={14} className="animate-spin" /> : tool.status === 'error' ? <XCircle size={14} /> : <CheckCircle2 size={14} />

  return (
    <div className={`border rounded overflow-hidden text-[0.9em] max-[768px]:text-[0.8em] ${expanded ? 'border-[#3a3a4a] my-1' : 'border-transparent'}`}>
      <div className={`flex items-center gap-2 px-[10px] py-1 bg-[#2a2a3a] cursor-pointer select-none hover:bg-[#333345] ${expanded ? 'rounded-t' : 'rounded'}`} onClick={() => setExpanded(!expanded)}>
        <span className={`text-[0.85em] w-[18px] text-center flex-shrink-0 ${statusColor}`}>{statusIcon}</span>
        <span className="bg-[#444460] text-[#ccc] px-2 py-[1px] rounded text-[0.85em] font-['SF_Mono','Fira_Code',monospace] flex-shrink-0">{tool.name}</span>
        {summary && <span className="text-[#999] overflow-hidden text-ellipsis whitespace-nowrap flex-1 font-['SF_Mono','Fira_Code',monospace] text-[0.85em]">{summary}</span>}
        <span className="text-[#666] flex-shrink-0 text-[0.8em]">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </div>
      {expanded && (
        <>
          {CustomRenderer && <CustomRenderer tool={tool} />}
          {hasRenderer && (
            <span
              className="inline-block px-[10px] py-[2px] text-[0.75em] text-[#666] cursor-pointer select-none font-['SF_Mono','Fira_Code',monospace] hover:text-[#999] hover:underline"
              onClick={() => setShowRawDetails(!showRawDetails)}
            >
              {showRawDetails ? 'less' : 'more details'}
            </span>
          )}
          {(!hasRenderer || showRawDetails) && (
            <div className="p-[10px] border-t border-[#3a3a4a] bg-[#1a1a2a] max-[768px]:text-[0.85em]">
              <div className="mb-2">
                <div className="text-[0.75em] font-semibold text-[#888] uppercase tracking-[0.05em] mb-1">Input</div>
                {formatValue(tool.input)}
              </div>
              {tool.result !== undefined && (
                <div>
                  <div className="text-[0.75em] font-semibold text-[#888] uppercase tracking-[0.05em] mb-1">Result{tool.isError ? ' (Error)' : ''}</div>
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
