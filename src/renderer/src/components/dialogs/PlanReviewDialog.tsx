import { useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { MarkdownContent } from '../messages/MarkdownContent'
import { ModelSelector } from '../input/ModelSelector'

interface PlanReviewDialogProps {
  request: PermissionRequest
  currentProvider: AgentProviderId
  selectedModel: string | undefined
  onModelChange: (model: string | undefined) => void
  onRequestChanges: (permissionId: number, feedback: string) => void
  onBuild: (permissionId: number, userNotes?: string) => void
  onClearContextBuild: (permissionId: number, userNotes?: string) => void
}

export function PlanReviewDialog({
  request,
  currentProvider,
  selectedModel,
  onModelChange,
  onRequestChanges,
  onBuild,
  onClearContextBuild,
}: PlanReviewDialogProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [notes, setNotes] = useState('')
  const trimmed = notes.trim()

  const input = (request.input as Record<string, unknown>) || {}
  const plan = (input.plan as string) || ''
  const planTitle = (input.planTitle as string) || undefined

  return (
    <div className="flex flex-col min-h-0 flex-1 max-[768px]:text-[0.9em]">
      {/* Plan content */}
      <div className="px-3.5 py-2 flex-1 overflow-y-auto min-h-0">
        {planTitle && (
          <h3 className="text-sm font-medium text-text-secondary px-0 mt-0 mb-1">{planTitle}</h3>
        )}
        <button
          className="inline-flex items-center gap-1 bg-transparent border-none text-text-faint cursor-pointer px-0 py-1 text-[0.8em] text-left w-fit hover:text-[#ccc]"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <><ChevronRight size={14} /> Show plan</> : <><ChevronDown size={14} /> Hide plan</>}
        </button>
        {!collapsed && (
          <div className="plan-permission-text">
            <MarkdownContent>{plan}</MarkdownContent>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="shrink-0 border-t border-[#3a3a2a] px-3.5 py-2.5 flex flex-col gap-2 max-[768px]:px-3 max-[768px]:py-2">
        <textarea
          className="w-full min-h-12 bg-bg-tertiary border border-[#444] rounded-md text-[#ddd] px-2.5 py-2 font-[inherit] text-[0.85em] resize-y box-border focus:outline-none focus:border-accent"
          placeholder="Add notes or request changes..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
        />
        <div className="flex items-center gap-2 flex-wrap max-[768px]:gap-1.5">
          <button
            className="border-none rounded-md px-3.5 py-1.5 text-[0.85em] font-medium cursor-pointer transition-[background] duration-150 bg-[#555] text-white hover:bg-text-dim disabled:opacity-40 disabled:cursor-not-allowed max-[768px]:min-h-9"
            onClick={() => onRequestChanges(request.id, trimmed)}
            disabled={!trimmed}
            title={trimmed ? 'Send feedback to revise the plan' : 'Type notes to request changes'}
          >
            Request Changes
          </button>
          <div className="flex-1" />
          <ModelSelector provider={currentProvider} selectedModel={selectedModel} onModelChange={onModelChange} />
          <button
            className="border border-[#555] rounded-md px-3.5 py-1.5 text-[0.85em] font-medium cursor-pointer transition-all duration-150 bg-transparent text-[#ccc] hover:bg-white/5 hover:text-white hover:border-[#777] max-[768px]:min-h-9"
            onClick={() => onClearContextBuild(request.id, trimmed || undefined)}
            title="Open a new chat with only the plan as context"
          >
            New Chat &amp; Build
          </button>
          <button
            className="border-none rounded-md px-4 py-1.5 text-[0.85em] font-medium cursor-pointer transition-[background] duration-150 bg-success text-white hover:bg-[#43a047] max-[768px]:min-h-9"
            onClick={() => onBuild(request.id, trimmed || undefined)}
          >
            Build
          </button>
        </div>
      </div>
    </div>
  )
}
