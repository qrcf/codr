import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '@clerk/clerk-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { PanelLeftClose, PanelLeftOpen, Square, AlertTriangle, ClipboardList, Minimize2 } from 'lucide-react'
import { timeAgo } from './utils/timeAgo'
import { MessageBubble } from './components/MessageBubble'
import { ToolCallBlock } from './components/ToolCallBlock'
import { PermissionDialog } from './components/PermissionDialog'
import { QuestionDialog } from './components/QuestionDialog'
import { PlanReview } from './components/PlanReview'
import { CollapsibleDialog } from './components/CollapsibleDialog'
import { Sidebar } from './components/Sidebar'
import { SettingsPanel } from './components/SettingsPanel'
import { ManageProjectPanel } from './components/ManageProjectPanel'
import { ContextUsageBar } from './components/ContextUsageBar'
import { FileMentionDropdown } from './components/FileMentionDropdown'
import { useDocsAPI } from './hooks/useDocsAPI'
import { useInputComposer } from './hooks/useInputComposer'
import { useDialogs } from './hooks/useDialogs'
import { useAgentConnection } from './hooks/useAgentConnection'
import { useSessionManager } from './hooks/useSessionManager'
import { useDraftSessions } from './hooks/useDraftSessions'
import { useArchivedSessions } from './hooks/useArchivedSessions'
import { formatMessageContent } from './utils/formatMessage'
import './App.css'

function truncate(s: string | undefined, max: number): string {
  if (!s) return ''
  return s.length > max ? s.slice(0, max) + '...' : s
}

export default function App() {
  const { getToken } = useAuth()
  const stableGetToken = useCallback(() => getToken(), [getToken])
  const docsAPI = useDocsAPI(stableGetToken)

  // Simple UI state
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (window.innerWidth <= 768) return false
    return localStorage.getItem('sidebar-open') !== 'false'
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [manageProjectOpen, setManageProjectOpen] = useState(false)

  // Scroll refs
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)

  // Shared bridge refs — created before any hooks so both useAgentConnection
  // and useSessionManager can reference the same activeSessionId.
  // useAgentConnection reads .current inside event callbacks (not at setup time),
  // so it's always up-to-date by the time events fire.
  const activeSessionIdRef = useRef<string | null>(null)
  const awaitingNewSessionRef = useRef(false)
  const setActiveSessionIdRef = useRef<(id: string | null) => void>(() => {})
  const onSessionCapturedRef = useRef<(sessionId: string, messages: import('./types').ChatMessage[], initialTokenUsage?: TokenUsage | null) => void>(() => {})
  const onDraftPromotedRef = useRef<(draftId: string) => void>(() => {})
  const resetInputRef = useRef<() => void>(() => {})

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
    onDraftPromoted: (draftId) => onDraftPromotedRef.current(draftId),
  })

  // --- Hook: Session Manager ---
  const session = useSessionManager({
    activeSessionIdRef,
    awaitingNewSessionRef,
    agent: {
      loadMessages: agent.loadMessages,
      resetStreaming: agent.resetStreaming,
      setIsLoading: agent.setIsLoading,
      setMessages: agent.setMessages,
    },
    resetInput: () => resetInputRef.current(),
    resetPlan: dialogs.resetPlan,
    restoreDialogState: dialogs.restoreDialogState,
    setPlanReview: dialogs.setPlanReview,
    setPlanReady: dialogs.setPlanReady,
    setMode: dialogs.setMode,
    draftActions: {
      createDraft: draftSessions.createDraft,
      removeDraft: draftSessions.removeDraft,
    },
  })

  // --- Hook: Input Composer ---
  // Destructured to avoid false-positive react-hooks/refs lint warnings in JSX
  const {
    input, setInput, textareaRef,
    mentionActive, mentionQuery, mentionIndex, fileCache,
    selectedFiles, setSelectedFiles, selectedDocs, setSelectedDocs,
    isDragOver,
    handleInputChange, handleMentionSelect, handleDocMentionSelect,
    handleKeyDown, handleDragOver, handleDragLeave, handleDrop, handlePaste,
    resetInput,
  } = useInputComposer({
    onSend: () => handleSend(),
    docsAPI,
    projectFolderRef: session.projectFolderRef,
    setMode: dialogs.setMode,
  })

  // Wire the bridge refs now that all hooks exist.
  // Must be in an effect to satisfy react-hooks/refs lint rule.
  useEffect(() => {
    setActiveSessionIdRef.current = session.setActiveSessionId
    onSessionCapturedRef.current = (sessionId, messages, initialTokenUsage) => {
      session.loadSession(sessionId, messages, initialTokenUsage)
    }
    activeSessionIdRef.current = session.activeSessionId
    resetInputRef.current = resetInput
    onDraftPromotedRef.current = (draftId) => {
      draftSessions.promoteDraft(draftId)
    }
  })

  // --- Scroll to bottom ---
  const scrollToBottom = useCallback(() => {
    const container = messagesContainerRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }, [])

  useEffect(() => {
    if (!agent.isLoadingHistoryRef.current) requestAnimationFrame(scrollToBottom)
  }, [agent.messages, agent.isLoading, agent.streamingText, agent.streamingThinking, agent.streamingTools,
    dialogs.permissionRequests, dialogs.questionRequests, dialogs.planReady, scrollToBottom])

  // Scroll-based pagination
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const handleScroll = () => {
      if (container.scrollTop < 200 && agent.hasMoreMessages) {
        const prevScrollHeight = container.scrollHeight
        agent.isLoadingHistoryRef.current = true
        agent.loadMoreMessages()
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight - prevScrollHeight
          agent.isLoadingHistoryRef.current = false
        })
      }
    }

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [agent.hasMoreMessages, agent.loadMoreMessages, agent.isLoadingHistoryRef])

  // --- Send handler (orchestrates all hooks) ---
  const handleSend = async () => {
    const fileRefs = selectedFiles.map(f => `@${f}`).join(' ')
    const docRefs = selectedDocs.map(d => `@docs:${d.name}`).join(' ')
    const rawInput = input.trim()
    const prompt = [docRefs, fileRefs, rawInput].filter(Boolean).join(' ')
    if (!prompt || agent.isLoading) return

    const usePlanMode = dialogs.mode === 'plan'
    const useAskMode = dialogs.mode === 'ask'
    resetInput()
    setInput('')
    agent.setMessages((prev) => [
      ...prev,
      { id: agent.nextId(), role: 'user', content: prompt, toolCalls: [] },
    ])
    agent.setIsLoading(true)
    agent.resetStreaming()

    // Clear question for current session
    if (session.activeSessionId) {
      dialogs.clearQuestionForSession(session.activeSessionId)
    }
    dialogs.resetPlan()

    const isDraft = session.activeSessionId?.startsWith('draft-')
    const isNewSession = !session.activeSessionId || isDraft

    const opts: { resumeSessionId?: string; planMode?: boolean; askMode?: boolean; cwd?: string } = {}
    if (!isNewSession) opts.resumeSessionId = session.activeSessionId!
    if (usePlanMode) opts.planMode = true
    if (useAskMode) opts.askMode = true
    if (isNewSession && session.selectedFolder) opts.cwd = session.selectedFolder

    // Signal that we're expecting a new session ID from the agent
    if (isNewSession) {
      awaitingNewSessionRef.current = true
    }

    await window.claude.query(prompt, Object.keys(opts).length > 0 ? opts : undefined)
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
    dialogs.setPlanReady(false)
    dialogs.setPlanReview(null)
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
    dialogs.setPlanReady(false)
    dialogs.setPlanReview(null)

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
    <div className="app-shell">
      <Sidebar
        isOpen={sidebarOpen}
        activeSessionId={session.activeSessionId}
        onLoadSession={(id, msgs) => { session.handleLoadSession(id, msgs); setSettingsOpen(false); setManageProjectOpen(false); }}
        onNewChat={() => { session.handleNewChat(); setSettingsOpen(false); setManageProjectOpen(false); }}
        onActiveSessionInfo={session.setActiveSession}
        onOpenSettings={() => { setSettingsOpen(true); setManageProjectOpen(false); }}
        onOpenManageProject={() => { setManageProjectOpen(true); setSettingsOpen(false); }}
        backgroundQuerySessionIds={agent.backgroundQuerySessionIds}
        sessionStatuses={(() => {
          const m = new Map<string, 'question' | 'plan-review' | 'permission'>()
          for (const sid of Object.keys(dialogs.questionRequests)) m.set(sid, 'question')
          for (const [sid, req] of Object.entries(dialogs.permissionRequests)) m.set(sid, req.tool === 'ExitPlanMode' ? 'plan-review' : 'permission')
          return m
        })()}
        onFolderChange={session.setSelectedFolder}
        onCloseSidebar={() => setSidebarOpen(false)}
        drafts={draftSessions.drafts}
        archivedIds={archive.archivedIds}
        showArchived={archive.showArchived}
        onToggleShowArchived={() => archive.setShowArchived(!archive.showArchived)}
        onArchiveSession={archive.archiveSession}
        onUnarchiveSession={archive.unarchiveSession}
      />
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}

      {manageProjectOpen && session.selectedFolder ? (
        <ManageProjectPanel
          folderPath={session.selectedFolder}
          onClose={() => setManageProjectOpen(false)}
        />
      ) : settingsOpen ? (
        <SettingsPanel
          onClose={() => setSettingsOpen(false)}
          docsAPI={docsAPI}
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
      ) : (
      <div className="app">
        <header className="app-header">
          <button className="btn-toggle-sidebar" onClick={toggleSidebar}>
            {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
          <h1>{session.projectTitle}</h1>
          {session.activeSession && (session.activeSession.customTitle || session.activeSession.generatedTitle) && (
            <div className="session-title-wrapper">
              <span className="session-title">
                {session.activeSession.customTitle || session.activeSession.generatedTitle}
              </span>
              <div className="session-title-tooltip" onClick={(e) => {
                const target = e.target as HTMLElement
                if (target.classList.contains('tooltip-value')) {
                  const text = target.textContent || ''
                  navigator.clipboard.writeText(text)
                  target.classList.add('copied')
                  setTimeout(() => target.classList.remove('copied'), 600)
                }
              }}>
                {session.activeSession.summary && (
                  <div className="tooltip-row">
                    <span className="tooltip-label">SDK Summary</span>
                    <span className="tooltip-value">{session.activeSession.summary}</span>
                  </div>
                )}
                {session.activeSession.generatedTitle && (
                  <div className="tooltip-row">
                    <span className="tooltip-label">Generated Title</span>
                    <span className="tooltip-value">{session.activeSession.generatedTitle}</span>
                  </div>
                )}
                {session.activeSession.customTitle && (
                  <div className="tooltip-row">
                    <span className="tooltip-label">Custom Title</span>
                    <span className="tooltip-value">{session.activeSession.customTitle}</span>
                  </div>
                )}
                {session.activeSession.firstPrompt && (
                  <div className="tooltip-row">
                    <span className="tooltip-label">First Prompt</span>
                    <span className="tooltip-value">{truncate(session.activeSession.firstPrompt, 120)}</span>
                  </div>
                )}
                {session.activeSession.cwd && (
                  <div className="tooltip-row">
                    <span className="tooltip-label">Project</span>
                    <span className="tooltip-value">{session.activeSession.cwd}</span>
                  </div>
                )}
                {session.activeSession.gitBranch && (
                  <div className="tooltip-row">
                    <span className="tooltip-label">Branch</span>
                    <span className="tooltip-value">{session.activeSession.gitBranch}</span>
                  </div>
                )}
                <div className="tooltip-row">
                  <span className="tooltip-label">Last Modified</span>
                  <span className="tooltip-value">{timeAgo(session.activeSession.lastModified)}</span>
                </div>
                <div className="tooltip-row">
                  <span className="tooltip-label">Session ID</span>
                  <span className="tooltip-value tooltip-mono">{session.activeSession.sessionId}</span>
                </div>
                <div className="tooltip-row">
                  <span className="tooltip-label">File Size</span>
                  <span className="tooltip-value">{session.activeSession.fileSize < 1024 ? `${session.activeSession.fileSize} B` : `${(session.activeSession.fileSize / 1024).toFixed(1)} KB`}</span>
                </div>
              </div>
            </div>
          )}
        </header>

        <div className="messages-container" ref={messagesContainerRef}>
          {agent.hasMoreMessages && (
            <div className="load-more-indicator">Loading earlier messages...</div>
          )}
          {agent.messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {agent.isLoading && (agent.streamingText || agent.streamingTools.length > 0) && (
            <div className="message message-assistant">
              {agent.streamingText && <div className="message-content"><Markdown remarkPlugins={[remarkGfm]}>{formatMessageContent(agent.streamingText)}</Markdown></div>}
              {agent.streamingTools.length > 0 && (
                <div className="tool-calls">
                  {agent.streamingTools.map((tool) => (
                    <ToolCallBlock key={tool.id} tool={tool} />
                  ))}
                </div>
              )}
              <div className="loading-indicator">
                <div className="spinner" />
                <span className="thinking">Working...</span>
                <button className="cancel-btn" onClick={handleInterrupt}>Cancel</button>
              </div>
            </div>
          )}

          {agent.isLoading && !agent.streamingText && agent.streamingTools.length === 0 && (
            <div className="message message-assistant">
              {agent.streamingThinking && (
                <div className="message-content streaming-thinking">
                  <Markdown remarkPlugins={[remarkGfm]}>{agent.streamingThinking}</Markdown>
                </div>
              )}
              <div className="loading-indicator">
                <div className="spinner" />
                <span className="thinking">{agent.isCompacting ? 'Compacting context...' : agent.streamingThinking ? 'Reasoning...' : 'Thinking...'}</span>
                <button className="cancel-btn" onClick={handleInterrupt}>Cancel</button>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {(dialogs.permissionRequests[session.activeSessionId || '_unknown'] || dialogs.questionRequests[session.activeSessionId || '_unknown'] || (dialogs.planReview && dialogs.planReady)) && (
          <div className="dialogs-area">
            {dialogs.permissionRequests[session.activeSessionId || '_unknown'] && (
              <CollapsibleDialog
                title={dialogs.permissionRequests[session.activeSessionId || '_unknown'].tool === 'ExitPlanMode' ? 'Plan Review' : 'Permission Required'}
                icon={dialogs.permissionRequests[session.activeSessionId || '_unknown'].tool === 'ExitPlanMode' ? <ClipboardList size={14} /> : <AlertTriangle size={14} />}
                variant={dialogs.permissionRequests[session.activeSessionId || '_unknown'].tool === 'ExitPlanMode' ? 'plan' : 'permission'}
              >
                <PermissionDialog request={dialogs.permissionRequests[session.activeSessionId || '_unknown']} onRespond={dialogs.handlePermissionResponse} onAlwaysAllow={dialogs.handleAlwaysAllow} />
              </CollapsibleDialog>
            )}
            {dialogs.questionRequests[session.activeSessionId || '_unknown'] && (
              <CollapsibleDialog title="Question" icon={<span className="collapsible-question-icon">?</span>} variant="question">
                <QuestionDialog request={dialogs.questionRequests[session.activeSessionId || '_unknown']} onRespond={dialogs.handleQuestionResponse} />
              </CollapsibleDialog>
            )}
            {dialogs.planReview && dialogs.planReady && (
              <CollapsibleDialog title="Plan ready for review" icon={<ClipboardList size={14} />} variant="plan-review">
                <PlanReview
                  plan={dialogs.planReview}
                  showActions={dialogs.planReady}
                  onApprove={handlePlanApprove}
                  onRequestChanges={handlePlanRequestChanges}
                />
              </CollapsibleDialog>
            )}
          </div>
        )}

        <div className="input-area-wrapper">
        {!dialogs.planReady && (
          <div
            className={`input-bar${isDragOver ? ' drag-over' : ''}`}
            style={{ position: 'relative' }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {mentionActive && (
              <FileMentionDropdown
                files={fileCache}
                docSources={docsAPI.sources}
                query={mentionQuery}
                activeIndex={mentionIndex}
                onSelect={handleMentionSelect}
                onSelectDoc={handleDocMentionSelect}
              />
            )}
            {(selectedFiles.length > 0 || selectedDocs.length > 0) && (
              <div className="file-tags-row">
                {selectedDocs.map(doc => (
                  <span key={`doc-${doc.id}`} className="file-tag doc-tag">
                    <span className="file-tag-name" title={doc.url}>📄 {doc.name}</span>
                    <button className="file-tag-remove"
                      onClick={() => setSelectedDocs(prev => prev.filter(d => d.id !== doc.id))}
                    >×</button>
                  </span>
                ))}
                {selectedFiles.map(file => (
                  <span key={file} className="file-tag">
                    <span className="file-tag-name" title={file}>{file.startsWith('/') ? file.split('/').pop() : file}</span>
                    <button className="file-tag-remove"
                      onClick={() => setSelectedFiles(prev => prev.filter(f => f !== file))}
                    >×</button>
                  </span>
                ))}
              </div>
            )}
            <textarea
              ref={textareaRef}
              className="input-field"
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="Send a message..."
              rows={1}
              disabled={agent.isLoading}
            />
            <div className="input-toolbar">
              <div className="input-toolbar-left">
                <div className="mode-selector">
                  {(['plan', 'code', 'ask'] as const).map((m) => (
                    <button
                      key={m}
                      className={`mode-btn${dialogs.mode === m ? ' active' : ''}`}
                      onClick={() => dialogs.setMode(m)}
                    >
                      {m.charAt(0).toUpperCase() + m.slice(1)}
                    </button>
                  ))}
                </div>
                {dialogs.mode !== 'ask' && <label className="allow-edits-toggle" title="Auto-approve file edits">
                  <input
                    type="checkbox"
                    checked={dialogs.autoApproveEdits}
                    onChange={dialogs.handleToggleAutoEdits}
                  />
                  <span className="toggle-track">
                    <span className="toggle-thumb" />
                  </span>
                  <span className="toggle-label">Allow edits</span>
                </label>}
                {session.activeSessionId && !session.activeSessionId.startsWith('draft-') && (
                  <button
                    className="btn-compact"
                    onClick={handleCompact}
                    disabled={agent.isLoading}
                    title="Compact context"
                  >
                    <Minimize2 size={13} />
                    <span>Compact</span>
                  </button>
                )}
                {session.activeSessionId && !session.activeSessionId.startsWith('draft-') && agent.tokenUsage && (
                  <ContextUsageBar {...agent.tokenUsage} />
                )}
              </div>
              <div className="input-toolbar-right">
                {agent.isLoading ? (
                  <button className="btn btn-interrupt" onClick={handleInterrupt}><Square size={14} /></button>
                ) : (
                  <button className="btn btn-send" onClick={handleSend} disabled={!input.trim() && selectedFiles.length === 0 && selectedDocs.length === 0}>Send</button>
                )}
              </div>
            </div>
          </div>
        )}
        </div>
      </div>
      )}
    </div>
  )
}
