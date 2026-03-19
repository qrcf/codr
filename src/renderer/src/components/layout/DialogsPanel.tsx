import { AlertTriangle } from 'lucide-react'
import { CollapsibleDialog } from '../dialogs/CollapsibleDialog'
import { PermissionDialog } from '../dialogs/PermissionDialog'
import { PlanReviewDialog } from '../dialogs/PlanReviewDialog'
import { QuestionDialog } from '../dialogs/QuestionDialog'
import type { PlanReviewState } from '../../types'

interface DialogsPanelProps {
  activeSessionId: string | null
  permissionRequests: Record<string, PermissionRequest>
  questionRequests: Record<string, QuestionRequest>
  planReview: PlanReviewState | null
  planReady: boolean
  onPermissionResponse: (id: number, allowed: boolean, message?: string) => void
  onAlwaysAllow: (id: number, toolName: string) => void
  onQuestionResponse: (id: number, answers: Record<string, string>) => void
  // Plan review actions
  currentProvider: AgentProviderId
  selectedModel: string | undefined
  onModelChange: (model: string | undefined) => void
  onPlanBuild: (permissionId: number) => void
  onPlanClearContextBuild: (permissionId: number) => void
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
  currentProvider,
  selectedModel,
  onModelChange,
  onPlanBuild,
  onPlanClearContextBuild,
}: DialogsPanelProps) {
  const key = activeSessionId || '_unknown'
  const permRequest = permissionRequests[key]
  const hasPermission = !!permRequest
  const isPlanPermission = permRequest?.tool === 'ExitPlanMode'
  const hasQuestion = !!questionRequests[key]
  const hasPlan = !!(planReview && planReady)

  if (!hasPermission && !hasQuestion && !hasPlan) return null

  return (
    <div className="flex flex-col gap-2 px-6 py-2 max-h-[70vh] overflow-y-auto max-[768px]:px-2">
      {hasPermission && isPlanPermission && (
        <PlanReviewDialog
          request={permRequest}
          currentProvider={currentProvider}
          selectedModel={selectedModel}
          onModelChange={onModelChange}
          onBuild={onPlanBuild}
          onClearContextBuild={onPlanClearContextBuild}
        />
      )}
      {hasPermission && !isPlanPermission && (
        <CollapsibleDialog
          title="Permission Required"
          icon={<AlertTriangle size={14} />}
          variant="permission"
        >
          <PermissionDialog request={permRequest} onRespond={onPermissionResponse} onAlwaysAllow={onAlwaysAllow} />
        </CollapsibleDialog>
      )}
      {hasQuestion && (
        <CollapsibleDialog title="Question" icon={<span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-accent text-white text-[0.8em] font-bold shrink-0">?</span>} variant="question">
          <QuestionDialog request={questionRequests[key]} onRespond={onQuestionResponse} />
        </CollapsibleDialog>
      )}

    </div>
  )
}
