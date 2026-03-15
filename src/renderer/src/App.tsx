import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react'
import { Sidebar, type ProjectInfo } from './components/Sidebar'
import { ChatHeader } from './components/ChatHeader'

const SettingsPanel = lazy(() => import('./components/SettingsPanel').then(m => ({ default: m.SettingsPanel })))
const ManageProjectPanel = lazy(() => import('./components/ManageProjectPanel').then(m => ({ default: m.ManageProjectPanel })))
import { MessageList } from './components/MessageList'
import { DialogsPanel } from './components/DialogsPanel'
import { InputArea } from './components/InputArea'
import { UpdateOverlay } from './components/UpdateOverlay'
import { PlanOverlay } from './components/PlanOverlay'
import type { ReasoningLevel } from './components/ReasoningSelector'
import { useDocsAPI } from './hooks/useDocsAPI'
import { useInputComposer } from './hooks/useInputComposer'
import { useDialogs } from './hooks/useDialogs'
import { useAgentConnection } from './hooks/useAgentConnection'
import { useSessionManager } from './hooks/useSessionManager'
import { useDraftSessions } from './hooks/useDraftSessions'
import { useArchivedSessions } from './hooks/useArchivedSessions'

export default function App() {
  const stableGetToken = useCallback(async () => {
    return window.claude.getAuthToken?.() ?? null
  }, [])
  const docsAPI = useDocsAPI(stableGetToken)

  // User profile (from Clerk via API, cached at app level)
  const [userProfile, setUserProfile] = useState<{
    email: string | null
    fullName: string | null
    imageUrl: string | null
  } | null>(null)
  useEffect(() => {
    window.claude.getUserProfile?.().then((p) => {
      if (p) setUserProfile(p)
    }).catch(() => {})
  }, [])

  // Auto-updater
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [updateDismissed, setUpdateDismissed] = useState(false)

  useEffect(() => {
    return window.claude.onUpdateStatus?.((status) => {
      setUpdateStatus(status)
      // Reset dismissed state when a new version arrives
      const dismissed = localStorage.getItem('codr:dismissed-update')
      if (status.version && dismissed !== status.version) {
        setUpdateDismissed(false)
      }
    })
  }, [])

  const showUpdateOverlay = updateStatus?.status === 'downloaded' && updateStatus.version && !updateDismissed

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
    window.claude.getIndexerStatus?.().then(s => {
      if (s?.status) setIndexerStatus(s.status)
    }).catch(() => {})
    const unsub = window.claude.onIndexerSetupProgress?.((p: { step: string; detail?: string; projectDir?: string }) => {
      if (p.projectDir) return // ignore project-specific events
      if (p.step === 'ready' || p.step === 'error' || p.step === 'setting-up') {
        setIndexerStatus(p.step)
      }
    })
    return () => { unsub?.() }
  }, [])

  // --- Per-project index status ---
  const [projectIndexStatus, setProjectIndexStatus] = useState<string>('not-indexed')
  const projectFolder = session.activeSession?.cwd || null
  useEffect(() => {
    if (!projectFolder) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProjectIndexStatus('not-indexed')
      return
    }
    window.claude.getIndexerProjectStatus?.(projectFolder).then(s => {
      setProjectIndexStatus(s?.status || 'not-indexed')
    }).catch(() => {})
    const unsub = window.claude.onIndexerSetupProgress?.((p: { step: string; detail?: string; projectDir?: string }) => {
      if (!p.projectDir || p.projectDir !== projectFolder) return
      if (p.step === 'indexed') setProjectIndexStatus('indexed')
      else if (p.step === 'indexing') setProjectIndexStatus('indexing')
      else if (p.step === 'error') setProjectIndexStatus('error')
    })
    return () => { unsub?.() }
  }, [projectFolder])

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
  } = useInputComposer({
    onSend: () => handleSend(),
    docsAPI,
    projectFolderRef: session.projectFolderRef,
  })

  // --- Model selector state ---
  const [selectedModel, setSelectedModel] = useState<string | undefined>(undefined)
  const [currentProvider, setCurrentProvider] = useState<'claude' | 'codex'>('claude')

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

  // Initialize provider + model + default reasoning on mount
  useEffect(() => {
    window.claude.getProvider?.().then(p => {
      setCurrentProvider(p)
      window.claude.getModels?.(p).then(result => {
        if (result?.selectedModel) setSelectedModel(result.selectedModel)
      })
    })
    // Read default reasoning from ~/.claude/settings.json effortLevel
    window.claude.getDefaults?.().then(defaults => {
      if (defaults?.effortLevel) {
        const level = defaults.effortLevel as ReasoningLevel
        setDefaultReasoning(level)
        // If localStorage has no stored value, apply the default
        if (!localStorage.getItem('codr:reasoning')) {
          handleReasoningChange(level)
        }
      }
    })
  }, [])

  const handleModelChange = async (model: string | undefined) => {
    setSelectedModel(model)
    await window.claude.setModel?.(currentProviderRef.current, model)
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
  })

  // --- Global Shift+Tab: cycle mode when a chat is open ---
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !e.shiftKey) return
      if (!session.activeSessionId) return
      e.preventDefault()
      const modes = ['plan', 'code', 'ask'] as const
      dialogs.setMode(prev => modes[(modes.indexOf(prev) + 1) % modes.length])
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [session.activeSessionId, dialogs])

  // Close plan overlay when switching sessions
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setShowPlanOverlay(false) }, [session.activeSessionId])

  // Reset scroll lock when session changes or user sends a message
  useEffect(() => {
    shouldAutoScrollRef.current = true
  }, [session.activeSessionId])

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
    hasMoreMessages,
    loadMoreMessages,
    isLoadingHistoryRef,
  } = agent

  useEffect(() => {
    if (!isLoadingHistoryRef.current) requestAnimationFrame(scrollToBottom)
  }, [messages, isLoading, streamingText, streamingThinking, streamingTools,
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

  // --- Send handler (orchestrates all hooks) ---
  const handleSend = async () => {
    const fileRefs = selectedFiles.map(f => `@${f}`).join(' ')
    const docRefs = selectedDocs.map(d => `@docs:${d.name}`).join(' ')
    const rawInput = input.trim()
    const prompt = [docRefs, fileRefs, rawInput].filter(Boolean).join(' ')
    const currentAttachments = attachments.length > 0 ? [...attachments] : undefined
    if ((!prompt && !currentAttachments) || agent.isLoading) return
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
      },
    ])
    agent.setIsLoading(true)
    agent.resetStreaming()

    // Clear question for current session
    if (session.activeSessionId) {
      dialogs.clearQuestionForSession(session.activeSessionId)
    }
    dialogs.resetPlan()

    const isDraft = session.activeSessionId?.startsWith('draft-')
    const isInvalidated = session.activeSessionId && invalidatedSessionsRef.current.has(session.activeSessionId)
    const isNewSession = !session.activeSessionId || isDraft || isInvalidated

    if (isInvalidated) {
      invalidatedSessionsRef.current.delete(session.activeSessionId!)
    }

    const opts: { resumeSessionId?: string; planMode?: boolean; askMode?: boolean; cwd?: string; model?: string; thinkingBudget?: 'low' | 'medium' | 'high'; attachments?: AttachmentMeta[] } = {}
    if (!isNewSession) opts.resumeSessionId = session.activeSessionId!
    if (usePlanMode) opts.planMode = true
    if (useAskMode) opts.askMode = true
    if (isNewSession && session.activeSession?.cwd) opts.cwd = session.activeSession.cwd
    if (selectedModel) opts.model = selectedModel
    if (reasoning !== 'auto') opts.thinkingBudget = reasoning
    if (currentAttachments) opts.attachments = currentAttachments

    // Signal that we're expecting a new session ID from the agent
    if (isNewSession) {
      awaitingNewSessionRef.current = true
    }

    await window.claude.query(prompt || '', Object.keys(opts).length > 0 ? opts : undefined)
  }

  const handleInterrupt = () => {
    window.claude.interrupt(session.activeSessionId ?? undefined)
  }

  const handleCompact = async () => {
    if (!session.activeSessionId || agent.isLoading) return
    agent.setIsLoading(true)
    agent.resetStreaming()
    await window.claude.query('/compact', { resumeSessionId: session.activeSessionId })
  }

  // --- Plan handlers ---
  const handlePlanApprove = async () => {
    const plan = dialogs.planReview
    if (plan) {
      dialogs.markPlanApproved(plan.planContent, plan.planFilePath)
    }
    dialogs.resetPlan()
    dialogs.setMode('code')

    const approvalMessage = plan
      ? `User has approved your plan. You can now start coding.\n\nYour plan has been saved to: ${plan.planFilePath}\n\n## Approved Plan:\n${plan.planContent}`
      : 'User has approved your plan. You can now start coding.'

    agent.setMessages((prev) => [
      ...prev,
      { id: agent.nextId(), role: 'user', content: 'Plan approved. Proceed with implementation.', toolCalls: [] },
    ])
    agent.setIsLoading(true)
    agent.resetStreaming()

    await window.claude.query(approvalMessage, { resumeSessionId: session.activeSessionId! })
  }

  const handlePlanRequestChanges = async (feedback: string) => {
    dialogs.resetPlan()

    agent.setMessages((prev) => [
      ...prev,
      { id: agent.nextId(), role: 'user', content: feedback, toolCalls: [] },
    ])
    agent.setIsLoading(true)
    agent.resetStreaming()

    await window.claude.query(
      `The user requested changes to the plan:\n\n${feedback}`,
      { resumeSessionId: session.activeSessionId!, planMode: true },
    )
  }

  const toggleSidebar = () => {
    setSidebarOpen((prev) => {
      const next = !prev
      localStorage.setItem('sidebar-open', String(next))
      return next
    })
  }

  return (
    <div className="flex h-screen w-full">
      {showUpdateOverlay && (
        <UpdateOverlay
          version={updateStatus.version!}
          onRestart={() => window.claude.installUpdate?.()}
          onDismiss={() => {
            setUpdateDismissed(true)
            localStorage.setItem('codr:dismissed-update', updateStatus.version!)
          }}
        />
      )}
      <Sidebar
        isOpen={sidebarOpen}
        activeSessionId={session.activeSessionId}
        onLoadSession={(id, msgs, usage, model) => {
          session.handleLoadSession(id, msgs, usage)
          sessionLoadHadModelRef.current = !!model
          if (model) setSelectedModel(model)
          setSettingsOpen(false)
          setManageProjectOpen(false)
        }}
        onNewChat={(provider, cwd) => {
          const p = provider || 'claude'
          session.handleNewChat(provider, cwd)
          setCurrentProvider(p)
          window.claude.getModels?.(p).then(result => { setSelectedModel(result?.selectedModel) })
          setSettingsOpen(false)
          setManageProjectOpen(false)
        }}
        onActiveSessionInfo={(s) => {
          session.setActiveSession(s)
          if (s?.provider) {
            setCurrentProvider(s.provider)
            // If the session load didn't find a model in the messages (e.g. Codex sessions),
            // use the model from the session index, or fall back to the provider default.
            if (!sessionLoadHadModelRef.current) {
              if (s.model) {
                setSelectedModel(s.model)
              } else {
                window.claude.getModels?.(s.provider).then(result => {
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
      />
      {sidebarOpen && <div className="hidden max-[768px]:block fixed inset-0 bg-black/50 z-40" onClick={() => setSidebarOpen(false)} />}

      {settingsOpen ? (
        <Suspense fallback={null}>
          <SettingsPanel
            onClose={() => setSettingsOpen(false)}
            docsAPI={docsAPI}
            userProfile={userProfile}
            onAddDocSource={async (url, name, crawlDepth, prefix) => {
              if (window.claude.addDocSource) {
                const result = await window.claude.addDocSource({ url, name, crawlDepth, prefix })
                if ('error' in result) throw new Error(result.error)
              }
            }}
            onRecrawlDocSource={async (sourceId, url, crawlDepth, prefix) => {
              if (window.claude.recrawlDocSource) {
                const result = await window.claude.recrawlDocSource(sourceId, url, crawlDepth, prefix)
                if (result?.error) throw new Error(result.error)
              }
            }}
          />
        </Suspense>
      ) : (
      <div className="flex flex-col h-screen flex-1 min-w-0 overflow-clip font-[system-ui,-apple-system,sans-serif] text-[14px] relative">
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
          isDraft={!!session.activeSessionId?.startsWith('draft-') && agent.messages.length === 0}
          allProjects={allProjects}
          onChangeProject={session.handleChangeProject}
          approvedPlan={dialogs.approvedPlan}
          onShowPlan={() => setShowPlanOverlay(true)}
          onOpenManageProject={(folder) => { setManageProjectFolder(folder); setManageProjectOpen(true); setSettingsOpen(false) }}
          onRegenTitle={window.claude.regenTitle ? (sessionId, firstPrompt) => window.claude.regenTitle!(sessionId, firstPrompt) : undefined}
        />

        <div className="flex-1 min-h-0 relative overflow-hidden">
          <MessageList
            messages={agent.messages}
            isLoading={agent.isLoading}
            streamingText={agent.streamingText}
            streamingTools={agent.streamingTools}
            streamingThinking={agent.streamingThinking}
            isCompacting={agent.isCompacting}
            hasMoreMessages={agent.hasMoreMessages}
            onInterrupt={handleInterrupt}
            messagesContainerRef={messagesContainerRef}
            messagesEndRef={messagesEndRef}
            approvedPlanToolIds={dialogs.approvedPlanToolIds}
            shouldAutoScrollRef={shouldAutoScrollRef}
          />
          {showPlanOverlay && dialogs.approvedPlan && (
            <PlanOverlay
              plan={dialogs.approvedPlan}
              onClose={() => setShowPlanOverlay(false)}
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
          onPlanApprove={handlePlanApprove}
          onPlanRequestChanges={handlePlanRequestChanges}
        />

        <div className="shrink-0 border-t border-border">
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
            docSources={docsAPI.sources}
          />
        </div>
      </div>
      )}
    </div>
  )
}
