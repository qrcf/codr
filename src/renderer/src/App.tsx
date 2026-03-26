import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react'
import { useCodr } from './hooks/useCodr'
import { Sidebar, type ProjectInfo } from './components/layout/Sidebar'
import { ChatHeader } from './components/layout/ChatHeader'

const SettingsPanel = lazy(() => import('./components/settings/SettingsPanel').then(m => ({ default: m.SettingsPanel })))
const ManageProjectPanel = lazy(() => import('./components/settings/ManageProjectPanel').then(m => ({ default: m.ManageProjectPanel })))
import { MessageList } from './components/layout/MessageList'
import { DialogsPanel } from './components/layout/DialogsPanel'
import { InputArea } from './components/layout/InputArea'
import { UpdateOverlay } from './components/overlays/UpdateOverlay'
import { PlanOverlay } from './components/overlays/PlanOverlay'
import { FolderEmptyState } from './components/ui/FolderEmptyState'
import type { ReasoningLevel } from './components/input/ReasoningSelector'
import { useDocsAPI } from './hooks/useDocsAPI'
import { useInputComposer } from './hooks/useInputComposer'
import { useDialogs } from './hooks/useDialogs'
import { useAgentConnection } from './hooks/useAgentConnection'
import { useSessionManager } from './hooks/useSessionManager'
import { useDraftSessions } from './hooks/useDraftSessions'
import { useArchivedSessions } from './hooks/useArchivedSessions'
import { useMessageQueue, type QueuedMessage } from './hooks/useMessageQueue'
import { hasStableSessionTitle } from './utils/session-title'
import { ContextPanel } from './components/layout/ContextPanel'
import { useLatestTodos } from './hooks/useLatestTodos'

export default function App() {
  const codr = useCodr()
  const stableGetToken = useCallback(async () => {
    return codr.getAuthToken?.() ?? null
  }, [codr])
  const docsAPI = useDocsAPI(stableGetToken)

  // User profile (from Clerk via API, cached at app level)
  const [userProfile, setUserProfile] = useState<{
    email: string | null
    fullName: string | null
    imageUrl: string | null
  } | null>(null)
  useEffect(() => {
    codr.getUserProfile?.().then((p) => {
      if (p) setUserProfile(p)
    }).catch(() => {})
  }, [codr])

  // Auto-updater
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [updateDismissed, setUpdateDismissed] = useState(false)

  useEffect(() => {
    return codr.onUpdateStatus?.((status) => {
      setUpdateStatus(status)
      // Reset dismissed state when a new version arrives
      const dismissed = localStorage.getItem('codr:dismissed-update')
      if (status.version && dismissed !== status.version) {
        setUpdateDismissed(false)
      }
    })
  }, [codr])

  const showUpdateOverlay = updateStatus != null && !updateDismissed && (
    (updateStatus.manual && ['checking', 'available', 'downloading', 'downloaded', 'error'].includes(updateStatus.status)) ||
    (!updateStatus.manual && updateStatus.status === 'downloaded' && !!updateStatus.version)
  )

  // Simple UI state
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (window.innerWidth <= 768) return false
    return localStorage.getItem('sidebar-open') !== 'false'
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [manageProjectOpen, setManageProjectOpen] = useState(false)
  const [manageProjectFolder, setManageProjectFolder] = useState<string | null>(null)
  const [allProjects, setAllProjects] = useState<ProjectInfo[]>([])
  const [showPlanOverlay, setShowPlanOverlay] = useState(false)
  const [contextPanelNarrow, setContextPanelNarrow] = useState(false)
  const [contextPanelExpanded, setContextPanelExpanded] = useState(false)
  const mainContentRef = useRef<HTMLDivElement>(null)

  // Scroll refs
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)

  // Shared bridge refs — created before any hooks so both useAgentConnection
  // and useSessionManager can reference the same activeSessionId.
  // useAgentConnection reads .current inside event callbacks (not at setup time),
  // so it's always up-to-date by the time events fire.
  const activeSessionIdRef = useRef<string | null>(null)
  const awaitingNewSessionRef = useRef(false)
  const setActiveSessionIdRef = useRef<(id: string | null) => void>(() => {})
  const onSessionCapturedRef = useRef<(sessionId: string, messages: import('./types').ChatMessage[], initialTokenUsage?: TokenUsage | null) => void>(() => {})
  const onDraftPromotedRef = useRef<(draftId: string, realSessionId?: string) => void>(() => {})
  const resetInputRef = useRef<() => void>(() => {})
  const invalidatedSessionsRef = useRef<Set<string>>(new Set())
  // Docs that have been injected into the current session — persists across turns
  const sessionDocsRef = useRef<string[]>([])

  // --- Hook: Message Queue ---
  const messageQueue = useMessageQueue()
  const processQueueRef = useRef<() => void>(() => {})
  const pendingSendFromQueueRef = useRef<QueuedMessage | null>(null)

  // --- Hook: Draft Sessions ---
  const draftSessions = useDraftSessions()

  // --- Hook: Archived Sessions ---
  const archive = useArchivedSessions()

  // --- Hook: Dialogs (must be first — provides callbacks for agent connection) ---
  const dialogs = useDialogs({ activeSessionIdRef })

  // --- Hook: Agent Connection ---
  const agent = useAgentConnection({
    activeSessionIdRef,
    awaitingNewSessionRef,
    setActiveSessionId: (id) => setActiveSessionIdRef.current(id),
    autoAllowedToolsRef: dialogs.autoAllowedToolsRef,
    invalidatedSessionsRef,
    dialogs: {
      onPermissionRequest: dialogs.onPermissionRequest,
      onPermissionCleared: dialogs.onPermissionCleared,
      onQuestionRequest: dialogs.onQuestionRequest,
      onQuestionCleared: dialogs.onQuestionCleared,
      onPlanWrite: dialogs.onPlanWrite,
      onExitPlanMode: dialogs.onExitPlanMode,
      onDoneWithPlanExit: dialogs.onDoneWithPlanExit,
      applyStateSync: dialogs.applyStateSync,
    },
    onSessionCaptured: (sid, msgs, usage) => onSessionCapturedRef.current(sid, msgs, usage),
    onDraftPromoted: (draftId, realSessionId) => onDraftPromotedRef.current(draftId, realSessionId),
    onDraftTitleGenerated: (draftId, title) => {
      draftSessions.setDraftGeneratedTitle(draftId, title)
    },
    onQueueProcess: () => processQueueRef.current(),
  })

  // --- Hook: Session Manager ---
  const session = useSessionManager({
    activeSessionIdRef,
    awaitingNewSessionRef,
    agent: {
      loadMessages: agent.loadMessages,
      resetStreaming: agent.resetStreaming,
      applyStreamingState: agent.applyStreamingState,
      setIsLoading: agent.setIsLoading,
      setMessages: agent.setMessages,
      saveActiveToCache: agent.saveActiveToCache,
      restoreFromCache: agent.restoreFromCache,
      reconcileFromDb: agent.reconcileFromDb,
      isLoadingRef: agent.isLoadingRef,
    },
    resetInput: () => resetInputRef.current(),
    resetPlan: dialogs.resetPlan,
    restoreDialogState: dialogs.restoreDialogState,
    setPlanReview: dialogs.setPlanReview,
    setPlanReady: dialogs.setPlanReady,
    setMode: dialogs.setMode,
    restoreApprovedPlan: dialogs.restoreApprovedPlan,
    clearApprovedPlan: dialogs.clearApprovedPlan,
    draftActions: {
      createDraft: draftSessions.createDraft,
      removeDraft: draftSessions.removeDraft,
      updateDraftCwd: draftSessions.updateDraftCwd,
    },
  })

  // --- Indexer status (global only — is LEANN installed?) ---
  const [indexerStatus, setIndexerStatus] = useState<string>('not-ready')
  useEffect(() => {
    codr.getIndexerStatus?.().then(s => {
      if (s?.status) setIndexerStatus(s.status)
    }).catch(() => {})
    const unsub = codr.onIndexerSetupProgress?.((p: { step: string; detail?: string; projectDir?: string }) => {
      if (p.projectDir) return // ignore project-specific events
      if (p.step === 'ready' || p.step === 'error' || p.step === 'setting-up') {
        setIndexerStatus(p.step)
      }
    })
    return () => { unsub?.() }
  }, [codr])

  // --- Per-project index status ---
  const [projectIndexStatus, setProjectIndexStatus] = useState<string>('not-indexed')
  const projectFolder = session.activeSession?.cwd || null
  useEffect(() => {
    if (!projectFolder) {
      setProjectIndexStatus('not-indexed')
      return
    }
    codr.getIndexerProjectStatus?.(projectFolder).then(s => {
      setProjectIndexStatus(s?.status || 'not-indexed')
    }).catch(() => {})
    // Proactively refresh index in the background when switching projects
    codr.backgroundRefreshIndex?.(projectFolder)
    const unsub = codr.onIndexerSetupProgress?.((p: { step: string; detail?: string; projectDir?: string }) => {
      if (!p.projectDir || p.projectDir !== projectFolder) return
      if (p.step === 'indexed') setProjectIndexStatus('indexed')
      else if (p.step === 'indexing') setProjectIndexStatus('indexing')
      else if (p.step === 'error') setProjectIndexStatus('error')
    })
    return () => { unsub?.() }
  }, [codr, projectFolder])

  // --- Hook: Input Composer ---
  // Destructured to avoid false-positive react-hooks/refs lint warnings in JSX
  const {
    input, setInput, textareaRef,
    mentionActive, mentionQuery, mentionIndex, fileCache,
    selectedFiles, setSelectedFiles, selectedDocs, setSelectedDocs,
    attachments, setAttachments,
    isDragOver,
    handleInputChange, handleMentionSelect, handleDocMentionSelect,
    handlePlusClick, handleFindReferencesSelect, handleRefFinderApprove,
    refFinderOpen, setRefFinderOpen,
    handleKeyDown, handleDragOver, handleDragLeave, handleDrop, handlePaste,
    resetInput,
    slashActive, slashIndex,
    filteredSlashCommands, handleSlashSelect,
  } = useInputComposer({
    onSend: () => handleSend(),
    docsAPI,
    projectFolderRef: session.projectFolderRef,
    availableCommands: agent.availableCommands,
  })

  // --- Model selector state ---
  const [selectedModel, setSelectedModel] = useState<string | undefined>(undefined)
  const [currentProvider, setCurrentProvider] = useState<AgentProviderId>('claude')

  // --- Reasoning level ---
  const [defaultReasoning, setDefaultReasoning] = useState<ReasoningLevel>('auto')
  const [reasoning, setReasoning] = useState<ReasoningLevel>(() => {
    return (localStorage.getItem('codr:reasoning') as ReasoningLevel | null) ?? 'auto'
  })
  const handleReasoningChange = (level: ReasoningLevel) => {
    setReasoning(level)
    localStorage.setItem('codr:reasoning', level)
  }
  const currentProviderRef = useRef(currentProvider)
  useEffect(() => { currentProviderRef.current = currentProvider })
  // Track whether the last onLoadSession call provided a model from session messages.
  // onActiveSessionInfo fires after onLoadSession, so if no model was found we fetch the provider default.
  const sessionLoadHadModelRef = useRef(false)
  // Track explicit user model changes so onActiveSessionInfo doesn't overwrite them
  // with the stale session-indexed model.
  const userChangedModelRef = useRef(false)

  // Initialize provider + model + default reasoning on mount
  useEffect(() => {
    codr.getProvider?.().then(p => {
      setCurrentProvider(p)
      codr.getModels?.(p).then(result => {
        if (result?.selectedModel) setSelectedModel(result.selectedModel)
      })
    })
    // Read default reasoning from ~/.claude/settings.json effortLevel
    codr.getDefaults?.().then(defaults => {
      if (defaults?.effortLevel) {
        const level = defaults.effortLevel as ReasoningLevel
        setDefaultReasoning(level)
        // If localStorage has no stored value, apply the default
        if (!localStorage.getItem('codr:reasoning')) {
          handleReasoningChange(level)
        }
      }
    })
  }, [codr])

  const handleModelChange = async (model: string | undefined) => {
    userChangedModelRef.current = true
    setSelectedModel(model)
    await codr.setModel?.(currentProviderRef.current, model)
  }

  const handleHeaderProviderChange = async (id: AgentProviderId) => {
    setCurrentProvider(id)
    userChangedModelRef.current = false
    await codr.setProvider?.(id)
    codr.getModels?.(id).then(result => { setSelectedModel(result?.selectedModel) })
  }

  // --- Send from queue (pulls data from a QueuedMessage instead of input state) ---
  const handleSendFromQueue = async (msg: QueuedMessage) => {
    shouldAutoScrollRef.current = true

    const usePlanMode = dialogs.mode === 'plan'
    const useAskMode = dialogs.mode === 'ask'
    const currentAttachments = msg.attachments.length > 0 ? msg.attachments : undefined
    const currentFiles = msg.selectedFiles.length > 0 ? [...msg.selectedFiles] : undefined
    // Merge queued docs into session-level ref
    if (msg.selectedDocs.length > 0) {
      const existing = new Set(sessionDocsRef.current)
      for (const d of msg.selectedDocs) {
        if (!existing.has(d.name)) sessionDocsRef.current.push(d.name)
      }
    }
    const currentDocs = sessionDocsRef.current.length > 0 ? [...sessionDocsRef.current] : undefined

    // addUserMessage pushes to both allMessagesRef and setMessages, sets isLoading
    // synchronously on the ref so in-flight reconciliation from prior onDone skips
    agent.addUserMessage({
      id: agent.nextId(),
      role: 'user',
      content: msg.rawInput || '(attachments)',
      toolCalls: [],
      attachments: currentAttachments,
      files: currentFiles,
      docs: currentDocs,
    })
    agent.resetStreaming()

    if (session.activeSessionId) {
      dialogs.clearQuestionForSession(session.activeSessionId)
    }
    dialogs.resetPlan()

    const isDraftSession = session.activeSessionId?.startsWith('draft-')
    const isInvalidated = session.activeSessionId && invalidatedSessionsRef.current.has(session.activeSessionId)
    const isNewSession = !session.activeSessionId || isDraftSession || isInvalidated

    if (isInvalidated) {
      invalidatedSessionsRef.current.delete(session.activeSessionId!)
    }

    const opts: { resumeSessionId?: string; planMode?: boolean; askMode?: boolean; cwd?: string; model?: string; thinkingBudget?: 'low' | 'medium' | 'high'; attachments?: AttachmentMeta[]; docNames?: string[]; filePaths?: string[] } = {}
    if (!isNewSession) opts.resumeSessionId = session.activeSessionId!
    if (usePlanMode) opts.planMode = true
    if (useAskMode) opts.askMode = true
    if (isNewSession && session.activeSession?.cwd) opts.cwd = session.activeSession.cwd
    if (selectedModel) opts.model = selectedModel
    if (reasoning !== 'auto') opts.thinkingBudget = reasoning
    if (currentAttachments) opts.attachments = currentAttachments
    if (currentDocs) opts.docNames = currentDocs
    if (currentFiles) opts.filePaths = currentFiles

    if (isNewSession) {
      awaitingNewSessionRef.current = true
    }

    await codr.query(msg.rawInput || '', Object.keys(opts).length > 0 ? opts : undefined)
  }

  // Wire the bridge refs now that all hooks exist.
  // Must be in an effect to satisfy react-hooks/refs lint rule.
  useEffect(() => {
    setActiveSessionIdRef.current = session.setActiveSessionId
    onSessionCapturedRef.current = (sessionId, messages, initialTokenUsage) => {
      session.loadSession(sessionId, messages, initialTokenUsage)
    }
    activeSessionIdRef.current = session.activeSessionId
    resetInputRef.current = resetInput
    onDraftPromotedRef.current = (draftId, realSessionId) => {
      draftSessions.promoteDraft(draftId, realSessionId)
    }
    processQueueRef.current = () => {
      const pending = pendingSendFromQueueRef.current
      if (pending) {
        pendingSendFromQueueRef.current = null
        handleSendFromQueue(pending)
        return
      }
      const next = messageQueue.dequeue()
      if (next) handleSendFromQueue(next)
    }
  })

  // --- Global Shift+Tab: cycle mode when a chat is open ---
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !e.shiftKey) return
      if (!session.activeSessionId) return
      e.preventDefault()
      const modes = ['code', 'plan', 'ask'] as const
      dialogs.setMode(prev => modes[(modes.indexOf(prev) + 1) % modes.length])
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [session.activeSessionId, dialogs])

  // Close plan overlay and clear queue when switching sessions (but not on draft→real promotion)
  const prevSessionIdForQueueRef = useRef(session.activeSessionId)
  useEffect(() => {
    const prev = prevSessionIdForQueueRef.current
    prevSessionIdForQueueRef.current = session.activeSessionId
    // Draft promotion: preserve queue and pending messages
    if (prev?.startsWith('draft-') && session.activeSessionId && !session.activeSessionId.startsWith('draft-')) {
      return
    }
    setShowPlanOverlay(false)
    messageQueue.clear()
    pendingSendFromQueueRef.current = null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.activeSessionId, messageQueue.clear])

  // Reset scroll lock when session changes or user sends a message
  useEffect(() => {
    shouldAutoScrollRef.current = true
  }, [session.activeSessionId])

  // Auto-focus input on new chat or session switch
  useEffect(() => {
    if (session.activeSessionId) {
      textareaRef.current?.focus()
    }
  }, [session.activeSessionId, textareaRef])

  // --- Scroll to bottom ---
  const scrollToBottom = useCallback(() => {
    if (!shouldAutoScrollRef.current) return
    const container = messagesContainerRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }, [])

  const {
    messages,
    isLoading,
    streamingText,
    streamingThinking,
    streamingTools,
    streamingSegments,
    hasMoreMessages,
    loadMoreMessages,
    isLoadingHistoryRef,
  } = agent

  // --- Derived: latest todos for context panel ---
  const latestTodos = useLatestTodos(messages, streamingTools)
  const showContextPanel = !!(latestTodos || dialogs.approvedPlan || dialogs.planReview)

  // --- ResizeObserver: collapse context panel when main content is narrow ---
  useEffect(() => {
    const el = mainContentRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContextPanelNarrow(entry.contentRect.width < 900)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Reset context panel expanded state on session switch
  useEffect(() => {
    setContextPanelExpanded(false)
  }, [session.activeSessionId])

  useEffect(() => {
    if (!isLoadingHistoryRef.current) requestAnimationFrame(scrollToBottom)
  }, [messages, isLoading, streamingText, streamingThinking, streamingTools, streamingSegments,
    isLoadingHistoryRef, dialogs.permissionRequests, dialogs.questionRequests, dialogs.planReady, scrollToBottom])

  // Scroll-based pagination
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const handleScroll = () => {
      if (container.scrollTop < 200 && hasMoreMessages) {
        const prevScrollHeight = container.scrollHeight
        isLoadingHistoryRef.current = true
        loadMoreMessages()
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight - prevScrollHeight
          isLoadingHistoryRef.current = false
        })
      }
    }

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [hasMoreMessages, loadMoreMessages, isLoadingHistoryRef])

  const handleInterrupt = () => {
    const sid = session.activeSessionId
    // Draft sessions use a temporary key in the provider — pass undefined to interrupt any active query
    codr.interrupt(sid?.startsWith('draft-') ? undefined : sid ?? undefined)
  }

  const handleSelectFolder = async () => {
    const folder = await codr.selectFolder()
    if (!folder) return
    session.handleChangeProject(folder)
  }

  // --- Send handler (orchestrates all hooks) ---
  const handleSend = async () => {
    const rawInput = input.trim()
    const prompt = rawInput
    const currentAttachments = attachments.length > 0 ? [...attachments] : undefined
    const currentFiles = selectedFiles.length > 0 ? [...selectedFiles] : undefined
    // Merge newly selected docs into the session-level ref
    if (selectedDocs.length > 0) {
      const existing = new Set(sessionDocsRef.current)
      for (const d of selectedDocs) {
        if (!existing.has(d.name)) sessionDocsRef.current.push(d.name)
      }
    }
    const currentDocs = sessionDocsRef.current.length > 0 ? [...sessionDocsRef.current] : undefined
    const hasContent = prompt || currentAttachments || currentFiles

    // If plan review is active, intercept and route through request-changes flow
    const planKey = session.activeSessionId || '_unknown'
    const planPermRequest = dialogs.permissionRequests[planKey]
    const isPlanReviewActive = planPermRequest?.tool === 'ExitPlanMode' && dialogs.planReady

    if (isPlanReviewActive && hasContent) {
      resetInput()
      setInput('')
      await handlePlanRequestChanges(planPermRequest.id, prompt || '(attachments)')
      return
    }

    // Empty input: if queued messages exist, stop AI (or send first queued)
    if (!hasContent) {
      if (messageQueue.queueRef.current.length > 0) {
        if (agent.isLoading) {
          handleInterrupt()
          // onDone will fire and auto-process the queue
        } else {
          const next = messageQueue.dequeue()
          if (next) handleSendFromQueue(next)
        }
      }
      return
    }

    // Queue the message if AI is still running
    if (agent.isLoading) {
      messageQueue.enqueue({
        id: `queued-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        prompt,
        rawInput,
        selectedFiles: [...selectedFiles],
        selectedDocs: [...selectedDocs],
        attachments: currentAttachments || [],
      })
      resetInput()
      setInput('')
      // Safety net: if onDone fired between reading isLoading state and enqueuing,
      // the ref is already false but React hasn't re-rendered yet — process the queue.
      setTimeout(() => {
        if (!agent.isLoadingRef.current) processQueueRef.current()
      }, 0)
      return
    }

    shouldAutoScrollRef.current = true

    const usePlanMode = dialogs.mode === 'plan'
    const useAskMode = dialogs.mode === 'ask'
    resetInput()
    setInput('')
    agent.setMessages((prev) => [
      ...prev,
      {
        id: agent.nextId(),
        role: 'user',
        content: prompt || '(attachments)',
        toolCalls: [],
        attachments: currentAttachments,
        files: currentFiles,
        docs: currentDocs,
      },
    ])
    agent.setIsLoading(true)
    agent.resetStreaming()

    // Clear question for current session
    if (session.activeSessionId) {
      dialogs.clearQuestionForSession(session.activeSessionId)
    }
    dialogs.resetPlan()

    const isDraftSession = session.activeSessionId?.startsWith('draft-')
    const isInvalidated = session.activeSessionId && invalidatedSessionsRef.current.has(session.activeSessionId)
    const isNewSession = !session.activeSessionId || isDraftSession || isInvalidated

    if (isInvalidated) {
      invalidatedSessionsRef.current.delete(session.activeSessionId!)
    }

    const opts: { resumeSessionId?: string; planMode?: boolean; askMode?: boolean; cwd?: string; model?: string; thinkingBudget?: 'low' | 'medium' | 'high'; attachments?: AttachmentMeta[]; docNames?: string[]; filePaths?: string[] } = {}
    if (!isNewSession) opts.resumeSessionId = session.activeSessionId!
    if (usePlanMode) opts.planMode = true
    if (useAskMode) opts.askMode = true
    if (isNewSession && session.activeSession?.cwd) opts.cwd = session.activeSession.cwd
    if (selectedModel) opts.model = selectedModel
    if (reasoning !== 'auto') opts.thinkingBudget = reasoning
    if (currentAttachments) opts.attachments = currentAttachments
    if (currentDocs) opts.docNames = currentDocs
    if (currentFiles) opts.filePaths = currentFiles

    // Signal that we're expecting a new session ID from the agent
    if (isNewSession) {
      awaitingNewSessionRef.current = true
    }

    await codr.query(prompt || '', Object.keys(opts).length > 0 ? opts : undefined)
  }

  const handleCompact = async () => {
    if (!session.activeSessionId || agent.isLoading) return
    agent.setIsLoading(true)
    agent.resetStreaming()
    await codr.query('/compact', { resumeSessionId: session.activeSessionId })
  }

  // --- Plan handlers ---
  const handlePlanBuild = async (permissionId: number) => {
    // Get plan content — prefer permission request input (what user actually reviewed),
    // fall back to planReview state
    const permKey = session.activeSessionId || '_unknown'
    const permRequest = dialogs.permissionRequests[permKey]
    const permInput = permRequest?.input as Record<string, unknown> | undefined

    const planContent = (permInput?.planContent || permInput?.plan || dialogs.planReview?.planContent) as string | undefined
    const planFilePath = (permInput?.planFilePath || dialogs.planReview?.planFilePath || 'plan') as string

    if (planContent) {
      dialogs.markPlanApproved(planContent, planFilePath)
    }

    // Capture any notes typed in the main input area
    const userNotes = input.trim() || undefined
    if (userNotes) {
      resetInput()
      setInput('')
    }

    // Allow ExitPlanMode permission to unblock the SDK / ACP extension method
    dialogs.handlePermissionResponse(permissionId, true)
    dialogs.resetPlan()
    dialogs.setMode('code')

    const displayMessage = userNotes || 'Plan approved. Proceed with implementation.'
    agent.setMessages((prev) => [
      ...prev,
      { id: agent.nextId(), role: 'user', content: displayMessage, toolCalls: [] },
    ])

    const notesClause = userNotes ? `\n\nUser notes: ${userNotes}` : ''
    const approvalMessage = planContent
      ? `User has approved your plan. You can now start coding.\n\nYour plan has been saved to: ${planFilePath}\n\n## Approved Plan:\n${planContent}${notesClause}`
      : `User has approved your plan. You can now start coding.${notesClause}`

    agent.setIsLoading(true)
    agent.resetStreaming()

    // Brief delay for permission response to settle before follow-up query
    await new Promise(resolve => setTimeout(resolve, 100))
    await codr.query(approvalMessage, {
      resumeSessionId: session.activeSessionId!,
      ...(selectedModel ? { model: selectedModel } : {}),
    })
  }

  const handlePlanClearContextBuild = async (permissionId: number) => {
    const cwd = session.activeSession?.cwd

    // Get plan content — prefer permission request input (what user actually reviewed),
    // fall back to planReview state
    const permKey = session.activeSessionId || '_unknown'
    const permRequest = dialogs.permissionRequests[permKey]
    const permInput = permRequest?.input as Record<string, unknown> | undefined

    const planContent = (permInput?.planContent || permInput?.plan || dialogs.planReview?.planContent) as string | undefined
    const planFilePath = (permInput?.planFilePath || dialogs.planReview?.planFilePath || 'plan') as string

    if (planContent) {
      dialogs.markPlanApproved(planContent, planFilePath)
    }

    // Capture any notes typed in the main input area
    const userNotes = input.trim() || undefined
    if (userNotes) {
      resetInput()
      setInput('')
    }

    // Allow ExitPlanMode permission (cleanup — don't leave agent hanging)
    dialogs.handlePermissionResponse(permissionId, true)
    dialogs.resetPlan()
    dialogs.setMode('code')

    // Start a fresh session — this clears approvedPlan, so re-apply after
    sessionDocsRef.current = []
    session.handleNewChat(currentProvider, cwd)
    if (planContent) {
      dialogs.markPlanApproved(planContent, planFilePath)
    }

    const notesClause = userNotes ? `\n\nAdditional user notes: ${userNotes}` : ''
    const planPrompt = planContent
      ? `The user has approved the following implementation plan and wants you to implement it.${notesClause}\n\n## Plan\n${planContent}`
      : `Implement the previously approved plan.${notesClause}`

    const displayMessage = userNotes
      ? `Implement plan (clean context): ${userNotes}`
      : 'Implement the approved plan (clean context).'
    agent.setMessages([
      { id: agent.nextId(), role: 'user', content: displayMessage, toolCalls: [] },
    ])
    agent.setIsLoading(true)
    agent.resetStreaming()
    awaitingNewSessionRef.current = true

    await codr.query(planPrompt, {
      ...(cwd ? { cwd } : {}),
      ...(selectedModel ? { model: selectedModel } : {}),
    })
  }

  const handlePlanRequestChanges = async (permissionId: number, feedback: string) => {
    const plan = dialogs.planReview
    // Deny the ExitPlanMode permission with the user's feedback
    dialogs.handlePermissionResponse(permissionId, false, feedback)
    dialogs.resetPlan()

    // Show feedback in chat (for all providers — gives user visual confirmation)
    agent.setMessages((prev) => [
      ...prev,
      { id: agent.nextId(), role: 'user', content: feedback, toolCalls: [] },
    ])

    // For ACP providers, the feedback flows through the extension method return.
    // For Claude SDK, the deny message goes through the permission gate.
    void plan
  }

  const toggleSidebar = () => {
    setSidebarOpen((prev) => {
      const next = !prev
      localStorage.setItem('sidebar-open', String(next))
      return next
    })
  }

  // isDraft: true while the active session still has a draft id (editable — controls project switcher)
  const isDraft = !!session.activeSessionId?.startsWith('draft-')
  const activeDraft = draftSessions.drafts.find(d => d.draftId === session.activeSessionId)
  const hasResolvedTitle = hasStableSessionTitle(session.activeSession)
  // isPendingNewChat: true while draft/promoted local metadata still marks this as pending.
  const isPendingNewChat = isDraft || (!!activeDraft?.pendingNewChat && !hasResolvedTitle)
  // showFolderPrompt: true when a new draft has no folder yet and no conversation has started.
  const showFolderPrompt = isDraft && !session.activeSession?.cwd && messages.length === 0 && !isLoading

  return (
    <div className="flex h-screen w-full">
      {showUpdateOverlay && (
        <UpdateOverlay
          status={updateStatus!}
          onRestart={() => codr.installUpdate?.()}
          onDismiss={() => {
            if (updateStatus?.status === 'downloaded' && updateStatus.version) {
              localStorage.setItem('codr:dismissed-update', updateStatus.version)
            }
            setUpdateDismissed(true)
            setUpdateStatus(null)
          }}
        />
      )}
      <Sidebar
        isOpen={sidebarOpen}
        activeSessionId={session.activeSessionId}
        onLoadSession={(id, msgs, usage, model) => {
          session.handleLoadSession(id, msgs, usage)
          sessionDocsRef.current = []
          sessionLoadHadModelRef.current = !!model
          userChangedModelRef.current = false
          if (model) setSelectedModel(model)
          setSettingsOpen(false)
          setManageProjectOpen(false)
        }}
        onNewChat={(provider, cwd) => {
          const p = provider || 'claude'
          let storedProject: string | undefined
          try {
            const parsed = JSON.parse(localStorage.getItem('projects') || '[]') as string[]
            storedProject = parsed[0]
          } catch {
            storedProject = undefined
          }
          const resolvedCwd = cwd || session.activeSession?.cwd || allProjects[0]?.path || storedProject
          session.handleNewChat(provider, resolvedCwd)
          sessionDocsRef.current = []
          setCurrentProvider(p)
          userChangedModelRef.current = false
          codr.getModels?.(p).then(result => { setSelectedModel(result?.selectedModel) })
          setSettingsOpen(false)
          setManageProjectOpen(false)
        }}
        onActiveSessionInfo={(s) => {
          session.setActiveSession(s)
          if (s?.provider) {
            setCurrentProvider(s.provider)
            // If the session load didn't find a model in the messages (e.g. Codex sessions),
            // use the model from the session index, or fall back to the provider default.
            // Skip if the user explicitly changed the model (e.g. via plan review selector).
            if (!sessionLoadHadModelRef.current && !userChangedModelRef.current) {
              if (s.model) {
                setSelectedModel(s.model)
              } else {
                codr.getModels?.(s.provider).then(result => {
                  if (result?.selectedModel) setSelectedModel(result.selectedModel)
                })
              }
            }
            sessionLoadHadModelRef.current = false
          }
          // Restore reasoning level from session, falling back to settings.json default
          if (s) {
            const level = (s.thinkingBudget as ReasoningLevel) || defaultReasoning
            handleReasoningChange(level)
          }
        }}
        onOpenSettings={() => { setSettingsOpen(true); setManageProjectOpen(false); }}
        onOpenManageProject={(folder) => { setManageProjectFolder(folder); setManageProjectOpen(true); setSettingsOpen(false); }}
        backgroundQuerySessionIds={agent.backgroundQuerySessionIds}
        sessionStatuses={(() => {
          const m = new Map<string, 'question' | 'plan-review' | 'permission'>()
          for (const sid of Object.keys(dialogs.questionRequests)) m.set(sid, 'question')
          for (const [sid, req] of Object.entries(dialogs.permissionRequests)) m.set(sid, req.tool === 'ExitPlanMode' ? 'plan-review' : 'permission')
          return m
        })()}
        onCloseSidebar={() => setSidebarOpen(false)}
        drafts={draftSessions.drafts}
        archivedIds={archive.archivedIds}
        showArchived={archive.showArchived}
        onToggleShowArchived={() => archive.setShowArchived(!archive.showArchived)}
        onArchiveSession={archive.archiveSession}
        onUnarchiveSession={archive.unarchiveSession}
        userProfile={userProfile}
        onProjectsUpdate={setAllProjects}
        onCleanupPromotedDraft={draftSessions.removeDraft}
        currentProvider={currentProvider}
      />
      {sidebarOpen && <div className="hidden max-[768px]:block fixed inset-0 bg-black/50 z-40" onClick={() => setSidebarOpen(false)} />}

      {settingsOpen ? (
        <Suspense fallback={null}>
          <SettingsPanel
            onClose={() => setSettingsOpen(false)}
            docsAPI={docsAPI}
            userProfile={userProfile}
            onAddDocSource={async (url, name, crawlDepth, prefix) => {
              if (codr.addDocSource) {
                const result = await codr.addDocSource({ url, name, crawlDepth, prefix })
                if ('error' in result) throw new Error(result.error)
              }
            }}
            onRecrawlDocSource={async (sourceId, name, url, crawlDepth, prefix) => {
              if (codr.recrawlDocSource) {
                const result = await codr.recrawlDocSource(sourceId, name, url, crawlDepth, prefix)
                if (result?.error) throw new Error(result.error)
              }
            }}
          />
        </Suspense>
      ) : (
      <div ref={mainContentRef} className="flex flex-col h-screen flex-1 min-w-0 overflow-clip font-[system-ui,-apple-system,sans-serif] text-[14px] relative">
        {manageProjectOpen && manageProjectFolder && (
          <div className="absolute inset-0 z-50">
            <Suspense fallback={null}>
              <ManageProjectPanel
                folderPath={manageProjectFolder}
                onClose={() => setManageProjectOpen(false)}
              />
            </Suspense>
          </div>
        )}
        <ChatHeader
          sidebarOpen={sidebarOpen}
          onToggleSidebar={toggleSidebar}
          projectTitle={session.projectTitle}
          activeSession={session.activeSession}
          isDraft={isDraft}
          isPendingNewChat={isPendingNewChat}
          allProjects={allProjects}
          onChangeProject={session.handleChangeProject}
          approvedPlan={dialogs.approvedPlan}
          onShowPlan={() => setShowPlanOverlay(true)}
          onOpenManageProject={(folder) => { setManageProjectFolder(folder); setManageProjectOpen(true); setSettingsOpen(false) }}
          onRegenTitle={codr.regenTitle ? (sessionId, firstPrompt) => codr.regenTitle!(sessionId, firstPrompt) : undefined}
          currentProvider={currentProvider}
          onProviderChange={handleHeaderProviderChange}
          canChangeProvider={isDraft && agent.messages.length === 0 && !agent.isLoading}
        />

        <div className="flex-1 min-h-0 relative overflow-hidden flex">
          <div className="flex-1 min-w-0 relative overflow-hidden">
            {showFolderPrompt ? (
              <FolderEmptyState onSelectFolder={handleSelectFolder} />
            ) : (
              <MessageList
                messages={agent.messages}
                isLoading={agent.isLoading}
                streamingText={agent.streamingText}
                streamingTools={agent.streamingTools}
                streamingThinking={agent.streamingThinking}
                streamingSegments={agent.streamingSegments}
                isCompacting={agent.isCompacting}
                hasMoreMessages={agent.hasMoreMessages}
                onInterrupt={handleInterrupt}
                messagesContainerRef={messagesContainerRef}
                messagesEndRef={messagesEndRef}
                approvedPlanToolIds={dialogs.approvedPlanToolIds}
                shouldAutoScrollRef={shouldAutoScrollRef}
              />
            )}
            {showPlanOverlay && dialogs.approvedPlan && (
              <PlanOverlay
                plan={dialogs.approvedPlan}
                onClose={() => setShowPlanOverlay(false)}
              />
            )}
          </div>
          {showContextPanel && (
            <ContextPanel
              todos={latestTodos}
              approvedPlan={dialogs.approvedPlan}
              pendingPlan={dialogs.planReview}
              onShowPlan={() => setShowPlanOverlay(true)}
              isNarrow={contextPanelNarrow}
              isExpanded={contextPanelExpanded}
              onToggleExpand={() => setContextPanelExpanded(p => !p)}
            />
          )}
        </div>
        <DialogsPanel
          activeSessionId={session.activeSessionId}
          permissionRequests={dialogs.permissionRequests}
          questionRequests={dialogs.questionRequests}
          planReview={dialogs.planReview}
          planReady={dialogs.planReady}
          onPermissionResponse={dialogs.handlePermissionResponse}
          onAlwaysAllow={dialogs.handleAlwaysAllow}
          onQuestionResponse={dialogs.handleQuestionResponse}
          currentProvider={currentProvider}
          selectedModel={selectedModel}
          onModelChange={handleModelChange}
          onPlanBuild={handlePlanBuild}
          onPlanClearContextBuild={handlePlanClearContextBuild}
        />

        <div className="shrink-0 border-t border-border">
          {showFolderPrompt ? (
            <div className="px-4 py-3 text-[0.85em] text-text-dim text-center select-none">
              Select a project folder above to start chatting
            </div>
          ) : (
          <InputArea
            input={input}
            textareaRef={textareaRef}
            mentionActive={mentionActive}
            mentionQuery={mentionQuery}
            mentionIndex={mentionIndex}
            fileCache={fileCache}
            selectedFiles={selectedFiles}
            setSelectedFiles={setSelectedFiles}
            selectedDocs={selectedDocs}
            setSelectedDocs={setSelectedDocs}
            attachments={attachments}
            setAttachments={setAttachments}
            isDragOver={isDragOver}
            handleInputChange={handleInputChange}
            handleMentionSelect={handleMentionSelect}
            handleDocMentionSelect={handleDocMentionSelect}
            handlePlusClick={handlePlusClick}
            handleKeyDown={handleKeyDown}
            handleDragOver={handleDragOver}
            handleDragLeave={handleDragLeave}
            handleDrop={handleDrop}
            handlePaste={handlePaste}
            refFinderOpen={refFinderOpen}
            setRefFinderOpen={setRefFinderOpen}
            handleFindReferencesSelect={handleFindReferencesSelect}
            handleRefFinderApprove={handleRefFinderApprove}
            indexerStatus={indexerStatus}
            projectIndexStatus={projectIndexStatus}
            projectFolder={session.projectFolderRef.current}
            mode={dialogs.mode}
            setMode={dialogs.setMode}
            autoApproveEdits={dialogs.autoApproveEdits}
            handleToggleAutoEdits={dialogs.handleToggleAutoEdits}
            planReady={dialogs.planReady}
            isLoading={agent.isLoading}
            tokenUsage={agent.tokenUsage}
            currentProvider={currentProvider}
            selectedModel={selectedModel}
            onModelChange={handleModelChange}
            reasoning={reasoning}
            onReasoningChange={handleReasoningChange}
            activeSessionId={session.activeSessionId}
            onSend={handleSend}
            onInterrupt={handleInterrupt}
            onCompact={handleCompact}
            slashActive={slashActive}
            filteredSlashCommands={filteredSlashCommands}
            slashIndex={slashIndex}
            handleSlashSelect={handleSlashSelect}
            docSources={docsAPI.sources}
            queuedMessages={messageQueue.queue}
            onRemoveQueued={messageQueue.remove}
            onSendQueued={(id) => {
              const msg = messageQueue.queue.find(m => m.id === id)
              if (!msg) return
              messageQueue.remove(id)
              if (agent.isLoading) {
                pendingSendFromQueueRef.current = msg
                handleInterrupt()
              } else {
                handleSendFromQueue(msg)
              }
            }}
            onEditQueued={(id) => {
              const msg = messageQueue.queue.find(m => m.id === id)
              if (!msg) return
              messageQueue.remove(id)
              setInput(msg.rawInput)
              setSelectedFiles(msg.selectedFiles)
              setSelectedDocs(msg.selectedDocs)
              setAttachments(msg.attachments)
              textareaRef.current?.focus()
            }}
          />
          )}
        </div>
      </div>
      )}
    </div>
  )
}
