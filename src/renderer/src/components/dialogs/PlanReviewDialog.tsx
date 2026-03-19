import { useState } from 'react'
import { ChevronRight, ChevronDown, ClipboardList } from 'lucide-react'
import { MarkdownContent } from '../messages/MarkdownContent'
import { ModelSelector } from '../input/ModelSelector'

interface PlanReviewDialogProps {
  request: PermissionRequest
  currentProvider: AgentProviderId
  selectedModel: string | undefined
  onModelChange: (model: string | undefined) => void
  onBuild: (permissionId: number) => void
  onClearContextBuild: (permissionId: number) => void
}

export function PlanReviewDialog({
  request,
  currentProvider,
  selectedModel,
  onModelChange,
  onBuild,
  onClearContextBuild,
}: PlanReviewDialogProps) {
  const [collapsed, setCollapsed] = useState(true)

  const input = (request.input as Record<string, unknown>) || {}
  const plan = (input.plan as string) || ''
  const planTitle = (input.planTitle as string) || undefined

  return (
    <div className="rounded-lg overflow-hidden border-2 border-accent bg-bg-card max-[768px]:text-[0.9em]">
      {/* Header */}
      <div className="flex items-center px-3.5 py-2">
        <button
          className="flex items-center gap-2 border-none bg-transparent cursor-pointer font-semibold text-[0.9em] transition-colors hover:bg-white/5 text-[#a0b0ff] px-0"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <ClipboardList size={14} />
          <span>Plan Review</span>
          {planTitle && <span className="font-normal text-text-faint ml-1">{planTitle}</span>}
        </button>
        <div className="flex-1" />
        <ModelSelector provider={currentProvider} selectedModel={selectedModel} onModelChange={onModelChange} />
      </div>
      {!collapsed && plan && (
        <div className="px-3.5 pb-2 overflow-y-auto max-h-[calc(70vh-100px)]">
          <div className="plan-permission-text">
            <MarkdownContent>{plan}</MarkdownContent>
          </div>
        </div>
      )}

      {/* Actions — always visible */}
      <div className="border-t border-[#3a3a2a] px-3.5 py-2 max-[768px]:px-3">
        <div className="flex items-center justify-end gap-2 flex-wrap max-[768px]:gap-1.5">
          <button
            className="border border-[#555] rounded-md px-3.5 py-1.5 text-[0.85em] font-medium cursor-pointer transition-all duration-150 bg-transparent text-[#ccc] hover:bg-white/5 hover:text-white hover:border-[#777] max-[768px]:min-h-9"
            onClick={() => onClearContextBuild(request.id)}
            title="Open a new chat with only the plan as context"
          >
            New Chat &amp; Build
          </button>
          <button
            className="border-none rounded-md px-4 py-1.5 text-[0.85em] font-medium cursor-pointer transition-[background] duration-150 bg-success text-white hover:bg-[#43a047] max-[768px]:min-h-9"
            onClick={() => onBuild(request.id)}
          >
            Build
          </button>
        </div>
      </div>
    </div>
  )
}
