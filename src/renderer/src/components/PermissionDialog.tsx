import { useState } from 'react'
import { ChevronRight, ChevronDown, Pencil, ClipboardList, AlertTriangle } from 'lucide-react'
import { MarkdownContent } from './MarkdownContent'
import { formatValue } from './formatValue'
import { DiffView } from './DiffView'
import { BashRenderer } from './renderers/BashRenderer'
import { WriteRenderer } from './renderers/WriteRenderer'
import type { ToolCallInfo } from '../types'

function PlanPermissionView({ plan }: { plan: string }) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div className="flex flex-col">
      <button className="inline-flex items-center gap-1 bg-transparent border-none text-text-faint cursor-pointer px-0 py-1 text-[0.8em] text-left w-fit hover:text-[#ccc]" onClick={() => setCollapsed(!collapsed)}>
        {collapsed ? <><ChevronRight size={14} /> Show plan</> : <><ChevronDown size={14} /> Hide plan</>}
      </button>
      {!collapsed && (
        <div className="plan-permission-text">
          <MarkdownContent>{plan}</MarkdownContent>
        </div>
      )}
    </div>
  )
}

function PermissionToolView({ request }: { request: PermissionRequest }) {
  const input = (request.input as Record<string, unknown>) || {}

  switch (request.tool) {
    case 'ExitPlanMode': {
      const plan = (input.plan as string) || ''
      return <PlanPermissionView plan={plan} />
    }
    case 'Edit': {
      const filePath = (input.file_path as string) || ''
      const oldString = (input.old_string as string) || ''
      const newString = (input.new_string as string) || ''
      const replaceAll = input.replace_all as boolean
      const fileName = filePath.split('/').pop() || filePath
      return (
        <div className="border-t border-[#3a3a4a]">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[#aaa] text-[0.85em]">
            <span className="text-warning font-bold"><Pencil size={14} /></span>
            <span className="font-['SF_Mono','Fira_Code',monospace] overflow-hidden text-ellipsis whitespace-nowrap" title={filePath}>{fileName}</span>
            {replaceAll && <span className="bg-[#444460] text-[#ccc] px-1.5 py-px rounded text-[0.85em]">replace all</span>}
          </div>
          <DiffView oldString={oldString} newString={newString} />
        </div>
      )
    }
    case 'Bash': {
      const toolInfo: ToolCallInfo = {
        id: `perm-${request.id}`,
        name: 'Bash',
        input,
        status: 'running',
      }
      return <BashRenderer tool={toolInfo} />
    }
    case 'Write': {
      const toolInfo: ToolCallInfo = {
        id: `perm-${request.id}`,
        name: 'Write',
        input,
        status: 'running',
      }
      return <WriteRenderer tool={toolInfo} />
    }
    default:
      return <>{formatValue(request.input)}</>
  }
}

function PlanActions({ request, onRespond }: {
  request: PermissionRequest
  onRespond: (id: number, allowed: boolean, message?: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [feedback, setFeedback] = useState('')

  const handleSendFeedback = () => {
    if (feedback.trim()) {
      onRespond(request.id, false, feedback.trim())
    }
  }

  if (editing) {
    return (
      <div className="plan-permission-feedback shrink-0 px-3.5 pb-2.5">
        <textarea
          className="w-full min-h-15 bg-bg-tertiary border border-[#444] rounded-md text-[#ddd] px-2.5 py-2 font-[inherit] text-[0.9em] resize-y mb-2 box-border focus:outline-none focus:border-accent"
          placeholder="What changes would you like?"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSendFeedback()
            }
          }}
          autoFocus
          rows={3}
        />
        <div className="flex gap-2 justify-end max-[768px]:flex-wrap max-[768px]:gap-1.5">
          <button className="border-none rounded-md px-4 py-2 text-[0.9em] font-medium cursor-pointer transition-[background] duration-150 bg-[#555] text-white hover:bg-text-dim disabled:opacity-40 disabled:cursor-not-allowed max-[768px]:min-h-10" onClick={() => { setEditing(false); setFeedback('') }}>Cancel</button>
          <button className="border-none rounded-md px-4 py-2 text-[0.9em] font-medium cursor-pointer transition-[background] duration-150 bg-success text-white hover:bg-[#43a047] disabled:opacity-40 disabled:cursor-not-allowed max-[768px]:min-h-10" onClick={handleSendFeedback} disabled={!feedback.trim()}>Send Feedback</button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-2 px-3.5 py-2.5 justify-end shrink-0 border-t border-[#3a3a2a] max-[768px]:flex-wrap max-[768px]:gap-1.5 max-[768px]:px-3 max-[768px]:py-2">
      <button className="border-none rounded-md px-4 py-2 text-[0.9em] font-medium cursor-pointer transition-[background] duration-150 bg-[#555] text-white hover:bg-text-dim disabled:opacity-40 disabled:cursor-not-allowed max-[768px]:min-h-10" onClick={() => setEditing(true)}>Request Changes</button>
      <button className="border-none rounded-md px-4 py-2 text-[0.9em] font-medium cursor-pointer transition-[background] duration-150 bg-success text-white hover:bg-[#43a047] disabled:opacity-40 disabled:cursor-not-allowed max-[768px]:min-h-10" onClick={() => onRespond(request.id, true)}>Approve Plan</button>
    </div>
  )
}

function getPermissionSummary(request: PermissionRequest): string | null {
  const input = (request.input as Record<string, unknown>) || {}
  switch (request.tool) {
    case 'Edit':
    case 'Write': {
      const filePath = (input.file_path as string) || ''
      return filePath.split('/').pop() || filePath
    }
    case 'Bash': {
      const cmd = (input.command as string) || ''
      return cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd
    }
    default:
      return null
  }
}

export function PermissionDialog({ request, onRespond, onAlwaysAllow }: {
  request: PermissionRequest
  onRespond: (id: number, allowed: boolean, message?: string) => void
  onAlwaysAllow: (id: number, toolName: string) => void
}) {
  const isPlan = request.tool === 'ExitPlanMode'
  const summary = !isPlan ? getPermissionSummary(request) : null

  return (
    <div className="flex flex-col min-h-0 flex-1 max-[768px]:text-[0.9em]">
      <div className="permission-header flex items-center gap-2 px-3.5 py-2.5 bg-border-subtle font-semibold text-[#a0b0ff] shrink-0 max-[768px]:px-3 max-[768px]:py-2">
        <span className="inline-flex items-center justify-center w-5.5 h-5.5 rounded-full bg-accent text-white text-[0.85em] font-bold shrink-0">{isPlan ? <ClipboardList size={14} /> : <AlertTriangle size={14} />}</span>
        {isPlan ? 'Plan Review' : 'Permission Required'}
      </div>
      {!isPlan && summary && (
        <div className="flex items-center gap-2 px-3.5 py-2 shrink-0 overflow-hidden">
          <span className="bg-[#444460] text-[#ccc] px-2 py-px rounded text-[0.85em] font-['SF_Mono','Fira_Code',monospace] shrink-0">{request.tool}</span>
          <span className="text-[#ccc] text-[0.85em] whitespace-nowrap overflow-hidden text-ellipsis font-['SF_Mono','Fira_Code','Cascadia_Code',monospace]">{summary}</span>
        </div>
      )}
      <div className="permission-detail px-3.5 py-2.5 flex-1 overflow-y-auto min-h-0">
        {!isPlan && !summary && <span className="bg-[#444460] text-[#ccc] px-2 py-px rounded text-[0.85em] font-['SF_Mono','Fira_Code',monospace] shrink-0 mb-2 inline-block">{request.tool}</span>}
        <PermissionToolView request={request} />
      </div>
      {isPlan ? (
        <PlanActions request={request} onRespond={onRespond} />
      ) : (
        <div className="flex gap-2 px-3.5 py-2.5 justify-end shrink-0 border-t border-[#3a3a2a] max-[768px]:flex-wrap max-[768px]:gap-1.5 max-[768px]:px-3 max-[768px]:py-2">
          <button className="border-none rounded-md px-4 py-2 text-[0.9em] font-medium cursor-pointer transition-[background] duration-150 bg-[#555] text-white hover:bg-text-dim disabled:opacity-40 disabled:cursor-not-allowed max-[768px]:min-h-10" onClick={() => onRespond(request.id, false)}>Deny</button>
          <button className="border-none rounded-md px-4 py-2 text-[0.9em] font-medium cursor-pointer transition-[background] duration-150 bg-[#2a6a2e] text-white hover:bg-[#338837] disabled:opacity-40 disabled:cursor-not-allowed max-[768px]:min-h-10" onClick={() => onAlwaysAllow(request.id, request.tool)}>Always Allow</button>
          <button className="border-none rounded-md px-4 py-2 text-[0.9em] font-medium cursor-pointer transition-[background] duration-150 bg-success text-white hover:bg-[#43a047] disabled:opacity-40 disabled:cursor-not-allowed max-[768px]:min-h-10" onClick={() => onRespond(request.id, true)}>Approve</button>
        </div>
      )}
    </div>
  )
}
