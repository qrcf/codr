import { AlertTriangle, ClipboardList } from 'lucide-react'
import { CollapsibleDialog } from './CollapsibleDialog'
import { PermissionDialog } from './PermissionDialog'
import { QuestionDialog } from './QuestionDialog'
import { PlanReview } from './PlanReview'
import type { PlanReviewState } from '../types'

interface DialogsPanelProps {
  activeSessionId: string | null
  permissionRequests: Record<string, PermissionRequest>
  questionRequests: Record<string, QuestionRequest>
  planReview: PlanReviewState | null
  planReady: boolean
  onPermissionResponse: (id: number, allowed: boolean, message?: string) => void
  onAlwaysAllow: (id: number, toolName: string) => void
  onQuestionResponse: (id: number, answers: Record<string, string>) => void
  onPlanApprove: () => void
  onPlanRequestChanges: (feedback: string) => void
}

export function DialogsPanel({
  activeSessionId,
  permissionRequests,
  questionRequests,
  planReview,
  planReady,
  onPermissionResponse,
  onAlwaysAllow,
  onQuestionResponse,
  onPlanApprove,
  onPlanRequestChanges,
}: DialogsPanelProps) {
  const key = activeSessionId || '_unknown'
  const hasPermission = !!permissionRequests[key]
  const hasQuestion = !!questionRequests[key]
  const hasPlan = !!(planReview && planReady)

  if (!hasPermission && !hasQuestion && !hasPlan) return null

  return (
    <div className="flex-shrink-0 flex flex-col gap-2 px-6 py-2 max-h-[70vh] overflow-y-auto border-t border-[#333] max-[768px]:px-2">
      {hasPermission && (
        <CollapsibleDialog
          title={permissionRequests[key].tool === 'ExitPlanMode' ? 'Plan Review' : 'Permission Required'}
          icon={permissionRequests[key].tool === 'ExitPlanMode' ? <ClipboardList size={14} /> : <AlertTriangle size={14} />}
          variant={permissionRequests[key].tool === 'ExitPlanMode' ? 'plan' : 'permission'}
        >
          <PermissionDialog request={permissionRequests[key]} onRespond={onPermissionResponse} onAlwaysAllow={onAlwaysAllow} />
        </CollapsibleDialog>
      )}
      {hasQuestion && (
        <CollapsibleDialog title="Question" icon={<span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#8142c7] text-white text-[0.8em] font-bold flex-shrink-0">?</span>} variant="question">
          <QuestionDialog request={questionRequests[key]} onRespond={onQuestionResponse} />
        </CollapsibleDialog>
      )}
      {hasPlan && (
        <CollapsibleDialog title="Plan ready for review" icon={<ClipboardList size={14} />} variant="plan-review">
          <PlanReview
            plan={planReview!}
            showActions={planReady}
            onApprove={onPlanApprove}
            onRequestChanges={onPlanRequestChanges}
          />
        </CollapsibleDialog>
      )}
    </div>
  )
}
