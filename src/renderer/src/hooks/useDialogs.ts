import { useState, useRef, useCallback } from 'react'
import type { PlanReviewState } from '../types'

interface UseDialogsParams {
  activeSessionIdRef: React.MutableRefObject<string | null>
}

/** Remove a key from an object, returning a new object */
function omitKey<T>(obj: Record<string, T>, key: string): Record<string, T> {
  const next = { ...obj }
  delete next[key]
  return next
}

export function useDialogs({ activeSessionIdRef }: UseDialogsParams) {
  const [permissionRequests, setPermissionRequests] = useState<Record<string, PermissionRequest>>({})
  const [questionRequests, setQuestionRequests] = useState<Record<string, QuestionRequest>>({})
  const permissionRequestsRef = useRef<Record<string, PermissionRequest>>({})
  const questionRequestsRef = useRef<Record<string, QuestionRequest>>({})
  const [autoApproveEdits, setAutoApproveEdits] = useState(false)
  const autoAllowedToolsRef = useRef(new Set<string>())
  const [planReview, setPlanReview] = useState<PlanReviewState | null>(null)
  const [planReady, setPlanReady] = useState(false)
  const exitPlanModeDetectedRef = useRef(false)
  const [mode, setMode] = useState<'plan' | 'code' | 'ask'>('code')

  // --- Callback handlers for useAgentConnection to invoke ---

  const onPermissionRequest = useCallback((key: string, request: PermissionRequest) => {
    setPermissionRequests(prev => ({ ...prev, [key]: request }))
    permissionRequestsRef.current = { ...permissionRequestsRef.current, [key]: request }
  }, [])

  const onPermissionCleared = useCallback((key: string, id: number) => {
    if (permissionRequestsRef.current[key]?.id === id) {
      permissionRequestsRef.current = omitKey(permissionRequestsRef.current, key)
      setPermissionRequests(prev => {
        if (prev[key]?.id !== id) return prev
        return omitKey(prev, key)
      })
    }
  }, [])

  const onQuestionRequest = useCallback((key: string, request: QuestionRequest) => {
    setQuestionRequests(prev => ({ ...prev, [key]: request }))
    questionRequestsRef.current = { ...questionRequestsRef.current, [key]: request }
  }, [])

  const onQuestionCleared = useCallback((key: string, id: number) => {
    if (questionRequestsRef.current[key]?.id === id) {
      questionRequestsRef.current = omitKey(questionRequestsRef.current, key)
      setQuestionRequests(prev => {
        if (prev[key]?.id !== id) return prev
        return omitKey(prev, key)
      })
    }
  }, [])

  const onPlanWrite = useCallback((planFilePath: string, planContent: string) => {
    setPlanReview({ planFilePath, planContent })
  }, [])

  const onExitPlanMode = useCallback((allowedPrompts?: Array<{ tool: string; prompt: string }>) => {
    exitPlanModeDetectedRef.current = true
    setPlanReview((prev) => prev ? { ...prev, allowedPrompts } : prev)
  }, [])

  const onDoneWithPlanExit = useCallback(() => {
    if (exitPlanModeDetectedRef.current) {
      exitPlanModeDetectedRef.current = false
      setPlanReady(true)
    }
  }, [])

  // --- State sync handler for web client ---

  const applyStateSync = useCallback((
    perms: Record<string, PermissionRequest>,
    quests: Record<string, QuestionRequest>,
    planReviewState: PlanReviewState | null,
    isLoading: boolean,
  ) => {
    setPermissionRequests(perms)
    permissionRequestsRef.current = perms
    setQuestionRequests(quests)
    questionRequestsRef.current = quests
    setPlanReview(planReviewState)
    if (planReviewState && !isLoading) {
      setPlanReady(true)
    }
  }, [])

  // --- Restore dialog state from getAgentState ---

  const restoreDialogState = useCallback((sessionId: string, state: {
    permissionRequest?: PermissionRequest | null
    questionRequest?: QuestionRequest | null
    planReview?: PlanReviewState | null
  }) => {
    if (state.permissionRequest) {
      setPermissionRequests(prev => ({ ...prev, [sessionId]: state.permissionRequest! }))
      permissionRequestsRef.current = { ...permissionRequestsRef.current, [sessionId]: state.permissionRequest! }
    }
    if (state.questionRequest) {
      setQuestionRequests(prev => ({ ...prev, [sessionId]: state.questionRequest! as QuestionRequest }))
      questionRequestsRef.current = { ...questionRequestsRef.current, [sessionId]: state.questionRequest! as QuestionRequest }
    }
    if (state.planReview) {
      setPlanReview(state.planReview)
    }
  }, [])

  // --- User-facing handlers ---

  const handlePermissionResponse = (id: number, allowed: boolean, message?: string) => {
    window.claude.respondPermission(id, allowed, message ? { message } : undefined)
    const key = activeSessionIdRef.current || '_unknown'
    setPermissionRequests(prev => omitKey(prev, key))
    permissionRequestsRef.current = omitKey(permissionRequestsRef.current, key)
  }

  const handleAlwaysAllow = (id: number, toolName: string) => {
    autoAllowedToolsRef.current.add(toolName)
    window.claude.respondPermission(id, true)
    const key = activeSessionIdRef.current || '_unknown'
    setPermissionRequests(prev => omitKey(prev, key))
    permissionRequestsRef.current = omitKey(permissionRequestsRef.current, key)

    if (toolName === 'Edit' || toolName === 'Write') {
      setAutoApproveEdits(true)
      window.claude.updateSettings({ autoApproveEdits: true })
    }
  }

  const handleQuestionResponse = (id: number, answers: Record<string, string>) => {
    window.claude.respondQuestion?.(id, answers)
    const key = activeSessionIdRef.current || '_unknown'
    setQuestionRequests(prev => omitKey(prev, key))
    questionRequestsRef.current = omitKey(questionRequestsRef.current, key)
  }

  const handleToggleAutoEdits = () => {
    const next = !autoApproveEdits
    setAutoApproveEdits(next)
    window.claude.updateSettings({ autoApproveEdits: next })
    if (!next) {
      autoAllowedToolsRef.current.delete('Edit')
      autoAllowedToolsRef.current.delete('Write')
    }
  }

  const clearQuestionForSession = useCallback((sessionId: string) => {
    setQuestionRequests(prev => omitKey(prev, sessionId))
    questionRequestsRef.current = omitKey(questionRequestsRef.current, sessionId)
  }, [])

  const resetPlan = useCallback(() => {
    setPlanReview(null)
    setPlanReady(false)
    exitPlanModeDetectedRef.current = false
  }, [])

  return {
    permissionRequests,
    questionRequests,
    autoApproveEdits,
    autoAllowedToolsRef,
    planReview,
    setPlanReview,
    planReady,
    setPlanReady,
    exitPlanModeDetectedRef,
    mode,
    setMode,
    // Callbacks for useAgentConnection
    onPermissionRequest,
    onPermissionCleared,
    onQuestionRequest,
    onQuestionCleared,
    onPlanWrite,
    onExitPlanMode,
    onDoneWithPlanExit,
    applyStateSync,
    restoreDialogState,
    // User-facing handlers
    handlePermissionResponse,
    handleAlwaysAllow,
    handleQuestionResponse,
    handleToggleAutoEdits,
    clearQuestionForSession,
    resetPlan,
  }
}
