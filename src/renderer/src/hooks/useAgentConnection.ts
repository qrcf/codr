import { useState, useRef, useEffect, useCallback } from 'react'
import type { ChatMessage, ToolCallInfo, AgentMessage, StreamEvent, PlanReviewState, InjectedContext } from '../types'
import { parseSessionMessages, extractTokenUsageFromRaw } from '../utils/sessionParser'
import { reconcileParsedMessages } from '../utils/message-reconciler'

const PAGE_SIZE = 50

let messageIdCounter = 0
function nextId() {
  return `msg-${++messageIdCounter}`
}

interface DialogCallbacks {
  onPermissionRequest: (key: string, request: PermissionRequest) => void
  onPermissionCleared: (key: string, id: number) => void
  onQuestionRequest: (key: string, request: QuestionRequest) => void
  onQuestionCleared: (key: string, id: number) => void
  onPlanWrite: (toolId: string, planFilePath: string, planContent: string) => void
  onExitPlanMode: (allowedPrompts?: Array<{ tool: string; prompt: string }>) => void
  onDoneWithPlanExit: () => void
  applyStateSync: (
    perms: Record<string, PermissionRequest>,
    quests: Record<string, QuestionRequest>,
    planReview: PlanReviewState | null,
    isLoading: boolean,
  ) => void
}

interface UseAgentConnectionParams {
  activeSessionIdRef: React.MutableRefObject<string | null>
  awaitingNewSessionRef: React.MutableRefObject<boolean>
  setActiveSessionId: (id: string | null) => void
  autoAllowedToolsRef: React.MutableRefObject<Set<string>>
  invalidatedSessionsRef: React.MutableRefObject<Set<string>>
  dialogs: DialogCallbacks
  onSessionCaptured: (sessionId: string, messages: ChatMessage[], initialTokenUsage?: TokenUsage | null) => void
  onDraftPromoted: (draftId: string, realSessionId?: string) => void
  onDraftTitleGenerated: (draftId: string, title: string) => void
}

export function useAgentConnection({
  activeSessionIdRef,
  awaitingNewSessionRef,
  setActiveSessionId,
  autoAllowedToolsRef,
  invalidatedSessionsRef,
  dialogs,
  onSessionCaptured,
  onDraftPromoted,
  onDraftTitleGenerated,
}: UseAgentConnectionParams) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isCompacting, setIsCompacting] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [streamingThinking, setStreamingThinking] = useState('')
  const [streamingTools, setStreamingTools] = useState<ToolCallInfo[]>([])
  const [hasMoreMessages, setHasMoreMessages] = useState(false)
  const [backgroundQuerySessionIds, setBackgroundQuerySessionIds] = useState<Set<string>>(new Set())
  const [tokenUsage, setTokenUsage] = useState<TokenUsage | null>(null)

  const allMessagesRef = useRef<ChatMessage[]>([])
  const isLoadingHistoryRef = useRef(false)
  const streamingTextRef = useRef('')
  const streamingThinkingRef = useRef('')
  const streamingToolsRef = useRef<ToolCallInfo[]>([])
  const isLoadingRef = useRef(false)
  const errorSessionRef = useRef<string | null>(null)

  // Keep ref in sync
  useEffect(() => { isLoadingRef.current = isLoading }, [isLoading])

  // Stable refs for callbacks so the event listener effect can use [] deps
  const dialogsRef = useRef(dialogs)
  useEffect(() => { dialogsRef.current = dialogs }, [dialogs])
  const onSessionCapturedRef = useRef(onSessionCaptured)
  useEffect(() => { onSessionCapturedRef.current = onSessionCaptured }, [onSessionCaptured])
  const onDraftPromotedRef = useRef(onDraftPromoted)
  useEffect(() => { onDraftPromotedRef.current = onDraftPromoted }, [onDraftPromoted])
  const onDraftTitleGeneratedRef = useRef(onDraftTitleGenerated)
  useEffect(() => { onDraftTitleGeneratedRef.current = onDraftTitleGenerated }, [onDraftTitleGenerated])

  const commitCurrentTurn = useCallback(() => {
    const text = streamingTextRef.current
    const tools = [...streamingToolsRef.current]
    const thinking = streamingThinkingRef.current

    if (text || tools.length > 0 || thinking) {
      setMessages((prev) => {
        const last = prev[prev.length - 1]
        if (!text && tools.length > 0 && last?.role === 'assistant') {
          const updated = [...prev]
          updated[updated.length - 1] = {
            ...last,
            toolCalls: [...last.toolCalls, ...tools],
            thinking: last.thinking || thinking || undefined,
          }
          return updated
        }
        return [...prev, { id: nextId(), role: 'assistant', content: text, toolCalls: tools, thinking: thinking || undefined }]
      })
    }

    streamingTextRef.current = ''
    streamingThinkingRef.current = ''
    streamingToolsRef.current = []
    setStreamingText('')
    setStreamingThinking('')
    setStreamingTools([])
  }, [])

  const resetStreaming = useCallback(() => {
    streamingTextRef.current = ''
    streamingThinkingRef.current = ''
    streamingToolsRef.current = []
    setStreamingText('')
    setStreamingThinking('')
    setStreamingTools([])
  }, [])

  const applyStreamingState = useCallback((state: {
    streamingText?: string
    streamingThinking?: string
    streamingTools?: ToolCallInfo[]
  }) => {
    const text = state.streamingText || ''
    const thinking = state.streamingThinking || ''
    const tools = state.streamingTools || []
    streamingTextRef.current = text
    streamingThinkingRef.current = thinking
    streamingToolsRef.current = [...tools]
    setStreamingText(text)
    setStreamingThinking(thinking)
    setStreamingTools([...tools])
  }, [])

  const loadMessages = useCallback((sessionMessages: ChatMessage[], initialTokenUsage?: TokenUsage | null) => {
    allMessagesRef.current = sessionMessages
    const initial = sessionMessages.slice(-PAGE_SIZE)
    isLoadingHistoryRef.current = sessionMessages.length > 0
    setMessages(initial)
    setTokenUsage(initialTokenUsage ?? null)
    setHasMoreMessages(sessionMessages.length > PAGE_SIZE)
    if (sessionMessages.length > 0) {
      requestAnimationFrame(() => { isLoadingHistoryRef.current = false })
    }
  }, [])

  // Pagination
  const loadMoreMessages = useCallback(() => {
    if (!hasMoreMessages) return
    // We need the container for scroll position — caller passes it via ref
    const all = allMessagesRef.current
    const currentCount = messages.length
    const remaining = all.length - currentCount
    if (remaining <= 0) {
      setHasMoreMessages(false)
      return
    }
    const nextBatch = Math.min(PAGE_SIZE, remaining)
    const startIdx = remaining - nextBatch
    const olderMessages = all.slice(startIdx, remaining)

    isLoadingHistoryRef.current = true
    setMessages((prev) => [...olderMessages, ...prev])
    setHasMoreMessages(startIdx > 0)
  }, [hasMoreMessages, messages.length])

  // --- The massive event listener effect ---
  useEffect(() => {
    const unsubs: Array<() => void> = []

    unsubs.push(window.claude.onMessage((raw, querySessionId) => {
      if (querySessionId) {
        setBackgroundQuerySessionIds(prev => {
          if (prev.has(querySessionId)) return prev
          const next = new Set(prev)
          next.add(querySessionId)
          return next
        })
      }

      // Adopt session ID for newly-started queries. Only fire when we're actively
      // awaiting a new session (set by handleSend) — prevents background queries
      // from being mistakenly adopted when activeSessionId is null (e.g. after "New Chat").
      const sessionId = (raw as { session_id?: string }).session_id
      if (sessionId && awaitingNewSessionRef.current &&
          (!activeSessionIdRef.current || activeSessionIdRef.current.startsWith('draft-'))) {
        const prevDraftId = activeSessionIdRef.current
        awaitingNewSessionRef.current = false
        activeSessionIdRef.current = sessionId
        setActiveSessionId(sessionId)

        // Promote draft to real session (pass real ID so draft row persists)
        if (prevDraftId?.startsWith('draft-')) {
          onDraftPromotedRef.current(prevDraftId, sessionId)
        }

        window.claude.getSessionMessages(sessionId).then((rawMessages) => {
          if (activeSessionIdRef.current !== sessionId) return
          const parsed = parseSessionMessages(rawMessages)
          onSessionCapturedRef.current(sessionId, parsed, extractTokenUsageFromRaw(rawMessages))
        }).catch(() => {})
      }

      const activeId = activeSessionIdRef.current
      if (activeId && querySessionId && querySessionId !== activeId) return
      if (!querySessionId && activeId) return
      if (!activeId && querySessionId) return

      setIsLoading(true)

      const isSubagent = !!(raw as { parent_tool_use_id?: string | null }).parent_tool_use_id
      const msg = raw as AgentMessage
      switch (msg.type) {
        case 'stream_event': {
          const evt = msg as StreamEvent
          if (evt.event.type === 'content_block_delta' && evt.event.delta?.type === 'text_delta' && evt.event.delta.text) {
            if (streamingToolsRef.current.length > 0) {
              commitCurrentTurn()
            }
            streamingTextRef.current += evt.event.delta.text
            setStreamingText(streamingTextRef.current)
          } else if (evt.event.type === 'content_block_delta' && evt.event.delta?.type === 'thinking_delta' && evt.event.delta.thinking) {
            streamingThinkingRef.current += evt.event.delta.thinking
            setStreamingThinking(streamingThinkingRef.current)
          } else if (evt.event.type === 'content_block_start' && evt.event.content_block?.type === 'tool_use') {
            const block = evt.event.content_block as { id?: string; name?: string }
            const toolInfo: ToolCallInfo = {
              id: block.id || `tool-${Date.now()}-${Math.random()}`,
              name: block.name || 'Unknown',
              input: {},
              status: 'running',
            }
            streamingToolsRef.current.push(toolInfo)
            setStreamingTools([...streamingToolsRef.current])
            if (block.name === 'ExitPlanMode') {
              dialogsRef.current.onExitPlanMode()
            }
          }
          break
        }
        case 'assistant': {
          const assistantMsg = msg as { message?: { content?: unknown[]; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } } }
          const usage = assistantMsg.message?.usage
          if (usage?.input_tokens) {
            if (isSubagent) {
              // Accumulate subagent tokens separately
              setTokenUsage(prev => prev ? {
                ...prev,
                subagentInputTokens: (prev.subagentInputTokens || 0) + usage.input_tokens!,
                subagentOutputTokens: (prev.subagentOutputTokens || 0) + (usage.output_tokens || 0),
              } : prev)
            } else {
              setTokenUsage(prev => ({
                inputTokens: usage.input_tokens!,
                outputTokens: usage.output_tokens || 0,
                cacheReadInputTokens: usage.cache_read_input_tokens || 0,
                cacheCreationInputTokens: usage.cache_creation_input_tokens || 0,
                contextWindow: prev?.contextWindow || 200000,
                subagentInputTokens: prev?.subagentInputTokens,
                subagentOutputTokens: prev?.subagentOutputTokens,
              }))
            }
          }
          const content = assistantMsg.message?.content
          if (Array.isArray(content)) {
            let updated = false
            for (const block of content) {
              const b = block as { type: string; id?: string; name?: string; input?: Record<string, unknown> }
              if (b.type === 'tool_use' && b.id) {
                const idx = streamingToolsRef.current.findIndex((t) => t.id === b.id)
                if (idx >= 0) {
                  streamingToolsRef.current[idx] = {
                    ...streamingToolsRef.current[idx],
                    input: b.input || {},
                  }
                  updated = true
                }

                if (b.name === 'Write') {
                  const filePath = b.input?.file_path as string
                  if (filePath?.includes('.claude/plans/')) {
                    dialogsRef.current.onPlanWrite(b.id, filePath, b.input?.content as string)
                  }
                }

                if (b.name === 'ExitPlanMode') {
                  dialogsRef.current.onExitPlanMode(
                    b.input?.allowedPrompts as Array<{ tool: string; prompt: string }> | undefined
                  )
                }
              }
            }
            if (updated) {
              setStreamingTools([...streamingToolsRef.current])
            }
          }
          break
        }
        case 'user': {
          const userMsg = msg as { message?: { content?: unknown[] } }
          const content = userMsg.message?.content
          if (Array.isArray(content)) {
            let updated = false
            for (const block of content) {
              const b = block as { type: string; tool_use_id?: string; content?: unknown; is_error?: boolean }
              if (b.type === 'tool_result' && b.tool_use_id) {
                const idx = streamingToolsRef.current.findIndex((t) => t.id === b.tool_use_id)
                if (idx >= 0) {
                  const resultText = typeof b.content === 'string'
                    ? b.content
                    : Array.isArray(b.content)
                      ? (b.content as Array<{ type: string; text?: string }>)
                        .filter((c) => c.type === 'text')
                        .map((c) => c.text || '')
                        .join('\n')
                      : ''
                  streamingToolsRef.current[idx] = {
                    ...streamingToolsRef.current[idx],
                    result: resultText,
                    isError: b.is_error === true,
                    status: b.is_error ? 'error' : 'done',
                  }
                  updated = true
                }
              }
            }
            if (updated) {
              setStreamingTools([...streamingToolsRef.current])
            }
          }
          break
        }
        case 'system': {
          const sysMsg = msg as { subtype?: string; status?: string | null; compact_metadata?: { trigger: string; pre_tokens: number } }
          if (sysMsg.subtype === 'status') {
            setIsCompacting(sysMsg.status === 'compacting')
          } else if (sysMsg.subtype === 'compact_boundary') {
            const tokens = sysMsg.compact_metadata?.pre_tokens
            const label = tokens ? `Context compacted (${Math.round(tokens / 1000)}k tokens summarized)` : 'Context compacted'
            commitCurrentTurn()
            setMessages((prev) => [
              ...prev,
              { id: nextId(), role: 'system', content: label, toolCalls: [] },
            ])
          }
          break
        }
        case 'injected_context': {
          const ic = (msg as { injectedContext?: InjectedContext }).injectedContext
          if (ic) {
            setMessages(prev => {
              const lastUserIdx = prev.findLastIndex((m: ChatMessage) => m.role === 'user')
              if (lastUserIdx < 0) return prev
              const updated = [...prev]
              updated[lastUserIdx] = { ...updated[lastUserIdx], injectedContext: ic }
              return updated
            })
          }
          break
        }
      }
    }))

    if (window.claude.onSessionIdentified) {
      unsubs.push(window.claude.onSessionIdentified(({ oldKey, newKey }) => {
        if (activeSessionIdRef.current === oldKey) {
          activeSessionIdRef.current = newKey
          setActiveSessionId(newKey)
        }
      }))
    }

    if (window.claude.onDraftTitleGenerated) {
      unsubs.push(window.claude.onDraftTitleGenerated((data, querySessionId) => {
        if (!data?.title || !querySessionId) return
        onDraftTitleGeneratedRef.current(querySessionId, data.title)
      }))
    }

    unsubs.push(window.claude.onError((error, querySessionId) => {
      if (querySessionId) {
        setBackgroundQuerySessionIds(prev => {
          if (!prev.has(querySessionId)) return prev
          const next = new Set(prev)
          next.delete(querySessionId)
          return next
        })
      }
      const activeId = activeSessionIdRef.current
      if (activeId && querySessionId && querySessionId !== activeId) return
      if (!querySessionId && activeId) return
      if (!activeId && querySessionId) return

      errorSessionRef.current = querySessionId || activeSessionIdRef.current

      // Track sessions that can no longer be resumed (e.g. after sleep/wake corruption)
      if (error.includes('can no longer be resumed') && activeSessionIdRef.current) {
        invalidatedSessionsRef.current.add(activeSessionIdRef.current)
      }

      commitCurrentTurn()
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'assistant', content: error, toolCalls: [] },
      ])
      setIsLoading(false)

      dialogsRef.current.onDoneWithPlanExit()
    }))

    unsubs.push(window.claude.onDone((querySessionId) => {
      if (querySessionId) {
        setBackgroundQuerySessionIds(prev => {
          if (!prev.has(querySessionId)) return prev
          const next = new Set(prev)
          next.delete(querySessionId)
          return next
        })
      }
      const activeId = activeSessionIdRef.current
      if (activeId && querySessionId && querySessionId !== activeId) return
      if (!querySessionId && activeId) return
      if (!activeId && querySessionId) return

      commitCurrentTurn()
      setIsLoading(false)

      dialogsRef.current.onDoneWithPlanExit()

      const sessionId = activeSessionIdRef.current
      const hadError = errorSessionRef.current === sessionId
      errorSessionRef.current = null
      if (sessionId && !hadError) {
        window.claude.getSessionMessages(sessionId).then((raw) => {
          if (activeSessionIdRef.current !== sessionId) return
          const parsed = reconcileParsedMessages(allMessagesRef.current, parseSessionMessages(raw))
          allMessagesRef.current = parsed
          const initial = parsed.slice(-PAGE_SIZE)
          setMessages(initial)
          setHasMoreMessages(parsed.length > PAGE_SIZE)
          const usage = extractTokenUsageFromRaw(raw)
          if (usage) setTokenUsage(usage)
        }).catch(() => {})
      }
    }))

    unsubs.push(window.claude.onPermissionRequest((request, querySessionId) => {
      if (autoAllowedToolsRef.current.has(request.tool)) {
        window.claude.respondPermission(request.id, true)
        return
      }
      const key = querySessionId || '_unknown'
      dialogsRef.current.onPermissionRequest(key, request)
    }))

    if (window.claude.onPermissionCleared) {
      unsubs.push(window.claude.onPermissionCleared((data, querySessionId) => {
        const key = querySessionId || '_unknown'
        dialogsRef.current.onPermissionCleared(key, data.id)
      }))
    }

    if (window.claude.onQuestionRequest) {
      unsubs.push(window.claude.onQuestionRequest((request, querySessionId) => {
        const key = querySessionId || '_unknown'
        dialogsRef.current.onQuestionRequest(key, request)
      }))
    }

    if (window.claude.onQuestionCleared) {
      unsubs.push(window.claude.onQuestionCleared((data, querySessionId) => {
        const key = querySessionId || '_unknown'
        dialogsRef.current.onQuestionCleared(key, data.id)
      }))
    }

    if (window.claude.onSessionUpdated) {
      unsubs.push(window.claude.onSessionUpdated(({ sessionId }) => {
        if (sessionId === activeSessionIdRef.current && !isLoadingRef.current) {
          window.claude.getSessionMessages(sessionId).then((raw) => {
            const parsed = reconcileParsedMessages(allMessagesRef.current, parseSessionMessages(raw))
            allMessagesRef.current = parsed
            setMessages(parsed.slice(-PAGE_SIZE))
            setHasMoreMessages(parsed.length > PAGE_SIZE)
            const usage = extractTokenUsageFromRaw(raw)
            if (usage) setTokenUsage(usage)
          }).catch(() => {})
        }
      }))
    }

    if (window.claude.onStateSync) {
      unsubs.push(window.claude.onStateSync((state) => {
        if (state.activeStates) {
          const activeIds = new Set(Object.keys(state.activeStates))
          setBackgroundQuerySessionIds(activeIds)

          const activeId = activeSessionIdRef.current
          const activeState = activeId ? state.activeStates[activeId] : null
          if (activeState) {
            setMessages(activeState.messages || [])
            setIsLoading(activeState.isLoading)
            setIsCompacting(activeState.isCompacting ?? false)
            setStreamingText(activeState.streamingText)
            setStreamingThinking(activeState.streamingThinking || '')
            setStreamingTools(activeState.streamingTools)
            if (activeState.tokenUsage) setTokenUsage(activeState.tokenUsage)
          }

          const perms: Record<string, PermissionRequest> = {}
          const quests: Record<string, QuestionRequest> = {}
          for (const [sid, s] of Object.entries(state.activeStates)) {
            if (s.isLoading && s.permissionRequest) perms[sid] = s.permissionRequest
            if (s.isLoading && s.questionRequest) quests[sid] = s.questionRequest
          }
          dialogsRef.current.applyStateSync(
            perms,
            quests,
            activeState?.planReview ?? null,
            activeState?.isLoading ?? false,
          )
        } else if (state.messages) {
          if (activeSessionIdRef.current) return
          setMessages(state.messages)
          setIsLoading(state.isLoading ?? false)
          setStreamingText(state.streamingText ?? '')
          setStreamingThinking(state.streamingThinking || '')
          setStreamingTools(state.streamingTools ?? [])
          dialogsRef.current.applyStateSync(
            state.permissionRequest ? { _unknown: state.permissionRequest } : {},
            state.questionRequest ? { _unknown: state.questionRequest } : {},
            state.planReview ?? null,
            state.isLoading ?? false,
          )
        }
      }))
    }

    // Wake recovery: if we're still loading after sleep/wake, force-reset
    if (window.claude.onWakeRecovery) {
      unsubs.push(window.claude.onWakeRecovery(() => {
        if (isLoadingRef.current) {
          commitCurrentTurn()
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: 'system', content: 'Session interrupted — you can send a new message to continue.', toolCalls: [] },
          ])
          setIsLoading(false)
          dialogsRef.current.onDoneWithPlanExit()
        }
      }))
    }

    return () => unsubs.forEach((fn) => fn())
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    messages,
    setMessages,
    isLoading,
    setIsLoading,
    isCompacting,
    streamingText,
    streamingThinking,
    streamingTools,
    hasMoreMessages,
    backgroundQuerySessionIds,
    tokenUsage,
    allMessagesRef,
    isLoadingHistoryRef,
    isLoadingRef,
    streamingTextRef,
    streamingThinkingRef,
    streamingToolsRef,
    commitCurrentTurn,
    resetStreaming,
    applyStreamingState,
    loadMessages,
    loadMoreMessages,
    nextId,
  }
}

export { nextId }
