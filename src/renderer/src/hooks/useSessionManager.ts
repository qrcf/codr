import { useState, useRef, useEffect, useCallback } from 'react'
import type { ChatMessage, PlanReviewState } from '../types'
import { parseSessionMessages, extractTokenUsageFromRaw } from '../utils/sessionParser'

interface AgentHandle {
  loadMessages: (sessionMessages: ChatMessage[], initialTokenUsage?: TokenUsage | null) => void
  resetStreaming: () => void
  setIsLoading: (v: boolean) => void
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>
}

interface DraftActions {
  createDraft: (cwd?: string) => { draftId: string; createdAt: number; cwd?: string }
  removeDraft: (draftId: string) => void
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
  draftActions,
}: UseSessionManagerParams) {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [activeSession, setActiveSession] = useState<SessionInfo | null>(null)
  const [selectedFolder, setSelectedFolder] = useState<string | null>(() => {
    return localStorage.getItem('selected-folder') || null
  })
  // resolvedRepoName is only set by the async getRepoName call
  const [resolvedRepoName, setResolvedRepoName] = useState<{ folder: string; name: string } | null>(null)
  const projectFolderRef = useRef<string | null>(null)

  // Derive project folder and title synchronously (no setState in effects)
  const projectFolder = selectedFolder || activeSession?.cwd || null
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
    window.claude.getRepoName?.(projectFolder)
      .then((name) => {
        if (!cancelled && projectFolderRef.current === projectFolder) {
          setResolvedRepoName({ folder: projectFolder, name })
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [projectFolder])

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

    // Clean up abandoned draft when switching away
    const prevId = activeSessionIdRef.current
    if (prevId?.startsWith('draft-') && sessionId !== prevId) {
      draftActions.removeDraft(prevId)
    }

    // Clear awaiting flag — we're explicitly loading a session (sidebar switch, new chat, etc.)
    awaitingNewSessionRef.current = false

    if (!isReloadingSameSession) {
      agent.loadMessages(sessionMessages, initialTokenUsage)
      agent.resetStreaming()
      agent.setIsLoading(false)
    }
    activeSessionIdRef.current = sessionId
    setActiveSessionId(sessionId)

    // Clear plan state
    resetPlan()

    // Restore live agent state if we have a session
    if (sessionId && !isReloadingSameSession && window.claude.getAgentState) {
      window.claude.getAgentState(sessionId).then((state) => {
        if (state.isLoading) {
          agent.setIsLoading(true)
        }
        if (state.isLoading) {
          restoreDialogState(sessionId, {
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
  }, [activeSessionIdRef, awaitingNewSessionRef, setActiveSessionId, agent, resetPlan, restoreDialogState, setPlanReview, setPlanReady, draftActions])

  // Restore saved session on mount
  useEffect(() => {
    const savedId = localStorage.getItem('active-session-id')
    if (savedId?.startsWith('draft-')) {
      // Restore draft as empty session (use microtask to match async pattern)
      Promise.resolve().then(() => loadSession(savedId, []))
    } else if (savedId) {
      window.claude.getSessionMessages(savedId)
        .then((raw) => loadSession(savedId, parseSessionMessages(raw), extractTokenUsageFromRaw(raw)))
        .catch(() => localStorage.removeItem('active-session-id'))
    } else if (window.claude.getAgentState) {
      window.claude.getAgentState().then((state) => {
        if (state.isLoading) {
          agent.setIsLoading(true)
        }
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleLoadSession = useCallback((sessionId: string, sessionMessages: ChatMessage[], initialTokenUsage?: TokenUsage | null) => {
    loadSession(sessionId, sessionMessages, initialTokenUsage)
  }, [loadSession])

  const handleNewChat = useCallback(() => {
    const draft = draftActions.createDraft(selectedFolder || undefined)
    loadSession(draft.draftId, [])
    resetInput()
    setMode('code')
  }, [loadSession, resetInput, setMode, draftActions, selectedFolder])

  return {
    activeSessionId,
    setActiveSessionId,
    activeSessionIdRef,
    activeSession,
    setActiveSession,
    selectedFolder,
    setSelectedFolder,
    projectTitle,
    projectFolderRef,
    loadSession,
    handleLoadSession,
    handleNewChat,
  }
}
