import { useState, useRef, useEffect, useCallback } from 'react'
import type { ChatMessage, PlanReviewState } from '../types'
import { parseSessionMessages, extractTokenUsageFromRaw } from '../utils/sessionParser'
import { useCodr } from './useCodr'

interface AgentHandle {
  loadMessages: (sessionMessages: ChatMessage[], initialTokenUsage?: TokenUsage | null) => void
  resetStreaming: () => void
  applyStreamingState: (state: {
    streamingText?: string
    streamingThinking?: string
    streamingTools?: import('../types').ToolCallInfo[]
  }) => void
  setIsLoading: (v: boolean) => void
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>
  saveActiveToCache: () => boolean
  restoreFromCache: (sessionId: string | null) => boolean
}

interface DraftActions {
  createDraft: (cwd?: string) => { draftId: string; createdAt: number; cwd?: string }
  removeDraft: (draftId: string) => void
  updateDraftCwd: (draftId: string, cwd: string) => void
}

interface UseSessionManagerParams {
  activeSessionIdRef: React.MutableRefObject<string | null>
  awaitingNewSessionRef: React.MutableRefObject<boolean>
  agent: AgentHandle
  resetInput: () => void
  resetPlan: () => void
  restoreDialogState: (sessionId: string, state: {
    permissionRequest?: PermissionRequest | null
    questionRequest?: QuestionRequest | null
    planReview?: PlanReviewState | null
  }) => void
  setPlanReview: (plan: PlanReviewState | null) => void
  setPlanReady: (ready: boolean) => void
  setMode: React.Dispatch<React.SetStateAction<'plan' | 'code' | 'ask'>>
  restoreApprovedPlan: (toolIds: string[], plan: { content: string; filePath: string } | null) => void
  clearApprovedPlan: () => void
  draftActions: DraftActions
}

export function useSessionManager({
  activeSessionIdRef,
  awaitingNewSessionRef,
  agent,
  resetInput,
  resetPlan,
  restoreDialogState,
  setPlanReview,
  setPlanReady,
  setMode,
  restoreApprovedPlan,
  clearApprovedPlan,
  draftActions,
}: UseSessionManagerParams) {
  const codr = useCodr()
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [activeSession, setActiveSession] = useState<SessionInfo | null>(null)
  // resolvedRepoName is only set by the async getRepoName call
  const [resolvedRepoName, setResolvedRepoName] = useState<{ folder: string; name: string } | null>(null)
  const projectFolderRef = useRef<string | null>(null)

  // Derive project folder and title synchronously (no setState in effects)
  const projectFolder = activeSession?.cwd || null
  const projectTitle = resolvedRepoName && resolvedRepoName.folder === projectFolder
    ? resolvedRepoName.name
    : projectFolder
      ? projectFolder.split('/').pop() || 'Codr'
      : 'Codr'

  // Keep projectFolderRef in sync
  useEffect(() => { projectFolderRef.current = projectFolder }, [projectFolder])

  // Async: resolve git repo name for nicer display
  useEffect(() => {
    if (!projectFolder) return
    let cancelled = false
    codr.getRepoName?.(projectFolder)
      .then((name) => {
        if (!cancelled && projectFolderRef.current === projectFolder) {
          setResolvedRepoName({ folder: projectFolder, name })
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [codr, projectFolder])

  // Persist active session ID to localStorage (skip initial render)
  const isInitialRender = useRef(true)
  useEffect(() => {
    if (isInitialRender.current) {
      isInitialRender.current = false
      return
    }
    if (activeSessionId) {
      localStorage.setItem('active-session-id', activeSessionId)
    } else {
      localStorage.removeItem('active-session-id')
    }
  }, [activeSessionId])

  // Canonical session loader
  const loadSession = useCallback((sessionId: string | null, sessionMessages: ChatMessage[], initialTokenUsage?: TokenUsage | null) => {
    const isReloadingSameSession = sessionId !== null && sessionId === activeSessionIdRef.current

    const prevId = activeSessionIdRef.current

    // Save active session state to cache so background queries keep accumulating.
    // Do NOT interrupt the previous session — it continues running in the background.
    let prevWasActive = false
    if (prevId && !isReloadingSameSession) {
      prevWasActive = agent.saveActiveToCache()
    }

    // Clean up abandoned draft when switching away — but not if it has an active query
    if (prevId?.startsWith('draft-') && sessionId !== prevId && !prevWasActive) {
      draftActions.removeDraft(prevId)
    }

    // Clear awaiting flag — we're explicitly loading a session (sidebar switch, new chat, etc.)
    awaitingNewSessionRef.current = false

    if (!isReloadingSameSession) {
      // Try to restore from cache first (session was running in background)
      const restored = agent.restoreFromCache(sessionId)
      if (!restored) {
        agent.loadMessages(sessionMessages, initialTokenUsage)
        agent.resetStreaming()
        agent.setIsLoading(false)
      }
    }
    activeSessionIdRef.current = sessionId
    setActiveSessionId(sessionId)

    // Clear plan state
    resetPlan()

    // Restore approved plan state from localStorage
    if (sessionId) {
      try {
        const saved = localStorage.getItem(`codr:approved-plans:${sessionId}`)
        if (saved) {
          const { toolIds, plan } = JSON.parse(saved)
          restoreApprovedPlan(toolIds, plan)
        } else {
          clearApprovedPlan()
        }
      } catch {
        clearApprovedPlan()
      }
    } else {
      clearApprovedPlan()
    }

    // Restore live agent state if we have a session
    if (sessionId && !isReloadingSameSession && codr.getAgentState) {
      const capturedSessionId = sessionId
      codr.getAgentState(sessionId).then((state) => {
        if (activeSessionIdRef.current !== capturedSessionId) return
        if (state.isLoading) {
          agent.setIsLoading(true)
          if (state.streamingThinking || state.streamingText || (state.streamingTools?.length ?? 0) > 0) {
            agent.applyStreamingState({
              streamingThinking: state.streamingThinking,
              streamingText: state.streamingText,
              streamingTools: state.streamingTools,
            })
          }
          restoreDialogState(capturedSessionId, {
            permissionRequest: state.permissionRequest,
            questionRequest: state.questionRequest,
            planReview: state.planReview,
          })
        }
      })
    }

    // Restore plan review from message history (for completed plan-mode sessions)
    if (sessionId && sessionMessages.length > 0) {
      const allAssistants = [...sessionMessages].reverse().filter(m => m.role === 'assistant')
      const exitPlanMsg = allAssistants.find(m => m.toolCalls.some(t => t.name === 'ExitPlanMode'))
      const exitPlanTool = exitPlanMsg?.toolCalls.find(t => t.name === 'ExitPlanMode')
      const writePlanMsg = allAssistants.find(m =>
        m.toolCalls.some(t => t.name === 'Write' && (t.input.file_path as string)?.includes('.claude/plans/'))
      )
      const writePlanTool = writePlanMsg?.toolCalls.find(
        t => t.name === 'Write' && (t.input.file_path as string)?.includes('.claude/plans/')
      )
      if (exitPlanTool && writePlanTool && exitPlanTool.status === 'running') {
        setPlanReview({
          planFilePath: writePlanTool.input.file_path as string,
          planContent: writePlanTool.input.content as string,
          allowedPrompts: exitPlanTool.input.allowedPrompts as Array<{ tool: string; prompt: string }> | undefined,
        })
        setPlanReady(true)
      }
    }
  }, [codr, activeSessionIdRef, awaitingNewSessionRef, setActiveSessionId, agent, resetPlan, restoreDialogState, setPlanReview, setPlanReady, restoreApprovedPlan, clearApprovedPlan, draftActions])

  // Restore saved session on mount
  useEffect(() => {
    const savedId = localStorage.getItem('active-session-id')
    if (savedId?.startsWith('draft-')) {
      // Restore draft as empty session (use microtask to match async pattern)
      Promise.resolve().then(() => loadSession(savedId, []))
    } else if (savedId) {
      codr.getSessionMessages(savedId)
        .then((raw) => loadSession(savedId, parseSessionMessages(raw), extractTokenUsageFromRaw(raw)))
        .catch(() => localStorage.removeItem('active-session-id'))
    } else if (codr.getAgentState) {
      codr.getAgentState().then((state) => {
        if (state.isLoading) {
          agent.setIsLoading(true)
        }
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleLoadSession = useCallback((sessionId: string, sessionMessages: ChatMessage[], initialTokenUsage?: TokenUsage | null) => {
    loadSession(sessionId, sessionMessages, initialTokenUsage)
  }, [loadSession])

  const handleNewChat = useCallback(async (provider?: 'claude' | 'codex', cwd?: string) => {
    const draft = draftActions.createDraft(cwd || activeSession?.cwd || undefined)
    loadSession(draft.draftId, [])
    resetInput()
    setMode('code')
    await codr.setProvider?.(provider || 'claude')
  }, [codr, loadSession, resetInput, setMode, draftActions, activeSession])

  const handleChangeProject = useCallback((cwd: string) => {
    const currentId = activeSessionIdRef.current
    if (!currentId?.startsWith('draft-')) return
    draftActions.updateDraftCwd(currentId, cwd)
    // Update activeSession so the header re-renders immediately
    setActiveSession(prev => prev ? { ...prev, cwd } : prev)
  }, [activeSessionIdRef, draftActions])

  return {
    activeSessionId,
    setActiveSessionId,
    activeSessionIdRef,
    activeSession,
    setActiveSession,
    projectTitle,
    projectFolderRef,
    loadSession,
    handleLoadSession,
    handleNewChat,
    handleChangeProject,
  }
}
