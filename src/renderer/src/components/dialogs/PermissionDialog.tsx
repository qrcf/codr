import { Pencil, AlertTriangle } from 'lucide-react'
import { formatValue } from '../messages/formatValue'
import { DiffView } from '../ui/DiffView'
import { BashRenderer } from '../renderers/BashRenderer'
import { WriteRenderer } from '../renderers/WriteRenderer'
import type { ToolCallInfo } from '../../types'

function PermissionToolView({ request }: { request: PermissionRequest }) {
  const input = (request.input as Record<string, unknown>) || {}

  switch (request.tool) {
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
        kind: 'Bash',
        input,
        status: 'running',
      }
      return <BashRenderer tool={toolInfo} />
    }
    case 'Write': {
      const toolInfo: ToolCallInfo = {
        id: `perm-${request.id}`,
        kind: 'Write',
        input,
        status: 'running',
      }
      return <WriteRenderer tool={toolInfo} />
    }
    default:
      return <>{formatValue(request.input)}</>
  }
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
  const summary = getPermissionSummary(request)

  return (
    <div className="flex flex-col min-h-0 flex-1 max-[768px]:text-[0.9em]">
      <div className="permission-header flex items-center gap-2 px-3.5 py-2.5 bg-border-subtle font-semibold text-[#a0b0ff] shrink-0 max-[768px]:px-3 max-[768px]:py-2">
        <span className="inline-flex items-center justify-center w-5.5 h-5.5 rounded-full bg-accent text-white text-[0.85em] font-bold shrink-0"><AlertTriangle size={14} /></span>
        Permission Required
      </div>
      {summary && (
        <div className="flex items-center gap-2 px-3.5 py-2 shrink-0 overflow-hidden">
          <span className="bg-[#444460] text-[#ccc] px-2 py-px rounded text-[0.85em] font-['SF_Mono','Fira_Code',monospace] shrink-0">{request.tool}</span>
          <span className="text-[#ccc] text-[0.85em] whitespace-nowrap overflow-hidden text-ellipsis font-['SF_Mono','Fira_Code','Cascadia_Code',monospace]">{summary}</span>
        </div>
      )}
      <div className="permission-detail px-3.5 py-2.5 flex-1 overflow-y-auto min-h-0">
        {!summary && <span className="bg-[#444460] text-[#ccc] px-2 py-px rounded text-[0.85em] font-['SF_Mono','Fira_Code',monospace] shrink-0 mb-2 inline-block">{request.tool}</span>}
        <PermissionToolView request={request} />
      </div>
      <div className="flex gap-2 px-3.5 py-2.5 justify-end shrink-0 border-t border-[#3a3a2a] max-[768px]:flex-wrap max-[768px]:gap-1.5 max-[768px]:px-3 max-[768px]:py-2">
        <button className="border-none rounded-md px-4 py-2 text-[0.9em] font-medium cursor-pointer transition-[background] duration-150 bg-[#555] text-white hover:bg-text-dim disabled:opacity-40 disabled:cursor-not-allowed max-[768px]:min-h-10" onClick={() => onRespond(request.id, false)}>Deny</button>
        <button className="border-none rounded-md px-4 py-2 text-[0.9em] font-medium cursor-pointer transition-[background] duration-150 bg-[#2a6a2e] text-white hover:bg-[#338837] disabled:opacity-40 disabled:cursor-not-allowed max-[768px]:min-h-10" onClick={() => onAlwaysAllow(request.id, request.tool)}>Always Allow</button>
        <button className="border-none rounded-md px-4 py-2 text-[0.9em] font-medium cursor-pointer transition-[background] duration-150 bg-success text-white hover:bg-[#43a047] disabled:opacity-40 disabled:cursor-not-allowed max-[768px]:min-h-10" onClick={() => onRespond(request.id, true)}>Approve</button>
      </div>
    </div>
  )
}
