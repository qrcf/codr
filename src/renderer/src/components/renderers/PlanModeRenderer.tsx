import { ClipboardList, Check } from 'lucide-react'
import type { ToolCallInfo } from '../../types'

export function EnterPlanModeRenderer({ tool }: { tool: ToolCallInfo }) {
  return (
    <div className="plan-mode-renderer plan-mode-enter">
      <span className="plan-mode-icon"><ClipboardList size={14} /></span>
      <span className="plan-mode-label">Entered plan mode</span>
      {tool.status === 'running' && <span className="plan-mode-status">...</span>}
    </div>
  )
}

export function ExitPlanModeRenderer({ tool }: { tool: ToolCallInfo }) {
  const prompts = tool.input.allowedPrompts as Array<{ tool: string; prompt: string }> | undefined
  const isApproved = tool.status === 'done' && !tool.isError
  const isRejected = tool.status === 'error' || tool.isError
  const isRunning = tool.status === 'running'

  const stateClass = isApproved ? 'plan-mode-approved' : isRejected ? 'plan-mode-rejected' : ''
  const label = isApproved
    ? 'Plan approved'
    : isRejected
      ? 'Plan — changes requested'
      : 'Plan ready for review'

  return (
    <div className={`plan-mode-renderer plan-mode-exit ${stateClass}`}>
      <span className="plan-mode-icon"><ClipboardList size={14} /></span>
      <span className="plan-mode-label">{label}</span>
      {isApproved && <Check size={14} />}
      {isRunning && prompts && prompts.length > 0 && (
        <span className="plan-mode-badge">{prompts.length} allowed tool{prompts.length !== 1 ? 's' : ''}</span>
      )}
    </div>
  )
}
