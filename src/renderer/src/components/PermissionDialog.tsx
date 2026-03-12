import { useState } from 'react'
import { ChevronRight, ChevronDown, Pencil, ClipboardList, AlertTriangle } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { formatValue } from './JsonHighlight'
import { DiffView } from './DiffView'
import { BashRenderer } from './renderers/BashRenderer'
import { WriteRenderer } from './renderers/WriteRenderer'
import type { ToolCallInfo } from '../types'

function PlanPermissionView({ plan }: { plan: string }) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div className="plan-permission-content">
      <button className="plan-collapse-toggle" onClick={() => setCollapsed(!collapsed)}>
        {collapsed ? <><ChevronRight size={14} /> Show plan</> : <><ChevronDown size={14} /> Hide plan</>}
      </button>
      {!collapsed && (
        <div className="plan-permission-text">
          <Markdown remarkPlugins={[remarkGfm]}>{plan}</Markdown>
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
        <div className="edit-renderer">
          <div className="edit-file-header">
            <span className="edit-file-icon"><Pencil size={14} /></span>
            <span className="edit-file-name" title={filePath}>{fileName}</span>
            {replaceAll && <span className="edit-replace-all-badge">replace all</span>}
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
      <div className="plan-permission-feedback">
        <textarea
          className="plan-feedback-textarea"
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
        <div className="permission-actions">
          <button className="btn btn-deny" onClick={() => { setEditing(false); setFeedback('') }}>Cancel</button>
          <button className="btn btn-approve" onClick={handleSendFeedback} disabled={!feedback.trim()}>Send Feedback</button>
        </div>
      </div>
    )
  }

  return (
    <div className="permission-actions">
      <button className="btn btn-deny" onClick={() => setEditing(true)}>Request Changes</button>
      <button className="btn btn-approve" onClick={() => onRespond(request.id, true)}>Approve Plan</button>
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
    <div className={`permission-dialog${isPlan ? ' plan-dialog' : ''}`}>
      <div className="permission-header">
        <span className="permission-icon">{isPlan ? <ClipboardList size={14} /> : <AlertTriangle size={14} />}</span>
        {isPlan ? 'Plan Review' : 'Permission Required'}
      </div>
      {!isPlan && summary && (
        <div className="permission-summary">
          <span className="tool-name-badge">{request.tool}</span>
          <span className="permission-summary-text">{summary}</span>
        </div>
      )}
      <div className="permission-detail">
        {!isPlan && !summary && <span className="tool-name-badge">{request.tool}</span>}
        <PermissionToolView request={request} />
      </div>
      {isPlan ? (
        <PlanActions request={request} onRespond={onRespond} />
      ) : (
        <div className="permission-actions">
          <button className="btn btn-deny" onClick={() => onRespond(request.id, false)}>Deny</button>
          <button className="btn btn-always-allow" onClick={() => onAlwaysAllow(request.id, request.tool)}>Always Allow</button>
          <button className="btn btn-approve" onClick={() => onRespond(request.id, true)}>Approve</button>
        </div>
      )}
    </div>
  )
}
