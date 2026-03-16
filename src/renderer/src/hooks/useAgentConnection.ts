import { useState, useRef, useEffect, useCallback } from 'react'
import type { ChatMessage, ToolCallInfo, AgentMessage, StreamEvent, PlanReviewState, InjectedContext } from '../types'
import { parseSessionMessages, extractTokenUsageFromRaw } from '../utils/sessionParser'
import { reconcileParsedMessages } from '../utils/message-reconciler'
import { useCodr } from './useCodr'

const PAGE_SIZE = 50

let messageIdCounter = 0
function nextId() {
  return `msg-${++messageIdCounter}`
}

// --- Session cache: stores accumulated state for background (non-active) sessions ---

interface SessionCache {
  messages: ChatMessage[]
  allMessages: ChatMessage[]
  streamingText: string
  streamingThinking: string
  streamingTools: ToolCallInfo[]
  isLoading: boolean
  isCompacting: boolean
  tokenUsage: TokenUsage | null
}

function createEmptyCache(): SessionCache {
  return {
    messages: [],
    allMessages: [],
    streamingText: '',
    streamingThinking: '',
    streamingTools: [],
    isLoading: true,
    isCompacting: false,
    tokenUsage: null,
  }
}

/** Commit pending streaming content into cache messages (mirrors commitCurrentTurn for active session). */
function commitCacheTurn(cache: SessionCache): void {
  const text = cache.streamingText
  const tools = [...cache.streamingTools]
  const thinking = cache.streamingThinking

  if (text || tools.length > 0 || thinking) {
    const last = cache.messages[cache.messages.length - 1]
    if (!text && tools.length > 0 && last?.role === 'assistant') {
      cache.messages[cache.messages.length - 1] = {
        ...last,
        toolCalls: [...last.toolCalls, ...tools],
        thinking: last.thinking || thinking || undefined,
      }
    } else {
      cache.messages.push({ id: nextId(), role: 'assistant', content: text, toolCalls: tools, thinking: thinking || undefined })
    }
  }

  cache.streamingText = ''
  cache.streamingThinking = ''
  cache.streamingTools = []
}

interface DialogCallbacks {
  onPermissionRequest: (key: string, request: PermissionRequest) => void
  onPermissionCleared: (key: string, id: number) => void
  onQuestionRequest: (key: string, request: QuestionRequest) => void
  onQuestionCleared: (key: string, id: number) => void
  onPlanWrite: (toolId: string, planFilePath: string, planContent: string, provider?: import('../../../shared/provider-types').AgentProviderId) => void
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
  onQueueProcess: () => void
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
  onQueueProcess,
}: UseAgentConnectionParams) {
  const codr = useCodr()
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

  // --- Session cache ref ---
  const sessionCacheRef = useRef<Map<string, SessionCache>>(new Map())

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
  const onQueueProcessRef = useRef(onQueueProcess)
  useEffect(() => { onQueueProcessRef.current = onQueueProcess }, [onQueueProcess])

  const commitCurrentTurn = useCallback(() => {
    const text = streamingTextRef.current
    const tools = [...streamingToolsRef.current]
    const thinking = streamingThinkingRef.current

    if (text || tools.length > 0 || thinking) {
      // Update allMessagesRef and messages state with the same objects
      const allMsgs = allMessagesRef.current
      const last = allMsgs[allMsgs.length - 1]
      if (!text && tools.length > 0 && last?.role === 'assistant') {
        const updatedLast: ChatMessage = {
          ...last,
          toolCalls: [...last.toolCalls, ...tools],
          thinking: last.thinking || thinking || undefined,
        }
        const updatedAll = [...allMsgs]
        updatedAll[updatedAll.length - 1] = updatedLast
        allMessagesRef.current = updatedAll
        setMessages((prev) => {
          const prevLast = prev[prev.length - 1]
          if (prevLast?.role === 'assistant') {
            const updated = [...prev]
            updated[updated.length - 1] = {
              ...prevLast,
              toolCalls: [...prevLast.toolCalls, ...tools],
              thinking: prevLast.thinking || thinking || undefined,
            }
            return updated
          }
          return prev
        })
      } else {
        const newMsg: ChatMessage = { id: nextId(), role: 'assistant', content: text, toolCalls: tools, thinking: thinking || undefined }
        allMessagesRef.current = [...allMsgs, newMsg]
        setMessages((prev) => [...prev, newMsg])
      }
    }

    streamingTextRef.current = ''
    streamingThinkingRef.current = ''
    streamingToolsRef.current = []
    setStreamingText('')
    setStreamingThinking('')
    setStreamingTools([])
  }, [])

  const addUserMessage = useCallback((msg: ChatMessage) => {
    allMessagesRef.current = [...allMessagesRef.current, msg]
    setMessages((prev) => [...prev, msg])
    // Mark loading synchronously so any in-flight reconciliation from a prior
    // onDone knows a new query is about to start and skips its stale overwrite.
    isLoadingRef.current = true
    setIsLoading(true)
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

  // --- Save/restore active session to/from cache ---

  /** Save the active session's state to cache. Returns true if saved (session was loading). */
  const saveActiveToCache = useCallback((): boolean => {
    const sid = activeSessionIdRef.current
    if (!sid) return false
    // Only cache sessions that are currently loading (have an active query).
    // Completed sessions will be reloaded from main process on switch-back.
    if (!isLoadingRef.current) return false

    // Save raw streaming state (not committed) so restore is faithful.
    // Messages come from allMessagesRef which is the canonical full history.
    sessionCacheRef.current.set(sid, {
      messages: [...allMessagesRef.current],
      allMessages: [...allMessagesRef.current],
      streamingText: streamingTextRef.current,
      streamingThinking: streamingThinkingRef.current,
      streamingTools: [...streamingToolsRef.current],
      isLoading: true,
      isCompacting: false,
      tokenUsage: null,
    })
    return true
  }, [activeSessionIdRef])

  const restoreFromCache = useCallback((sessionId: string | null): boolean => {
    if (!sessionId) return false
    const cache = sessionCacheRef.current.get(sessionId)
    if (!cache) return false
    sessionCacheRef.current.delete(sessionId)

    allMessagesRef.current = cache.allMessages
    const displayed = cache.messages.length > 0 ? cache.messages.slice(-PAGE_SIZE) : cache.allMessages.slice(-PAGE_SIZE)
    isLoadingHistoryRef.current = displayed.length > 0
    setMessages(displayed)
    setHasMoreMessages(cache.allMessages.length > PAGE_SIZE)
    setIsLoading(cache.isLoading)
    setIsCompacting(cache.isCompacting)
    setTokenUsage(cache.tokenUsage)

    streamingTextRef.current = cache.streamingText
    streamingThinkingRef.current = cache.streamingThinking
    streamingToolsRef.current = [...cache.streamingTools]
    setStreamingText(cache.streamingText)
    setStreamingThinking(cache.streamingThinking)
    setStreamingTools([...cache.streamingTools])

    if (displayed.length > 0) {
      requestAnimationFrame(() => { isLoadingHistoryRef.current = false })
    }

    return true
  }, [])

  /** Fetch messages from DB and reconcile with current state. Safe to call any time. */
  const reconcileFromDb = useCallback((sessionId: string) => {
    codr.getSessionMessages(sessionId).then((raw) => {
      if (activeSessionIdRef.current !== sessionId) return
      if (isLoadingRef.current) return
      const parsed = reconcileParsedMessages(allMessagesRef.current, parseSessionMessages(raw))
      allMessagesRef.current = parsed
      setMessages(parsed.slice(-PAGE_SIZE))
      setHasMoreMessages(parsed.length > PAGE_SIZE)
      const usage = extractTokenUsageFromRaw(raw)
      if (usage) setTokenUsage(usage)
    }).catch(() => {})
  }, [codr, activeSessionIdRef])

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

  // --- Background cache event processing ---

  function getOrCreateBgCache(sessionId: string): SessionCache {
    let cache = sessionCacheRef.current.get(sessionId)
    if (!cache) {
      cache = createEmptyCache()
      sessionCacheRef.current.set(sessionId, cache)
    }
    return cache
  }

  function processBackgroundMessage(querySessionId: string, raw: unknown): void {
    const cache = getOrCreateBgCache(querySessionId)
    cache.isLoading = true

    const msg = raw as AgentMessage
    const isSubagent = !!(raw as { parent_tool_use_id?: string | null }).parent_tool_use_id

    switch (msg.type) {
      case 'stream_event': {
        const evt = msg as StreamEvent
        if (evt.event.type === 'content_block_delta' && evt.event.delta?.type === 'text_delta' && evt.event.delta.text) {
          if (cache.streamingTools.length > 0) {
            commitCacheTurn(cache)
          }
          cache.streamingText += evt.event.delta.text
        } else if (evt.event.type === 'content_block_delta' && evt.event.delta?.type === 'thinking_delta' && evt.event.delta.thinking) {
          cache.streamingThinking += evt.event.delta.thinking
        } else if (evt.event.type === 'content_block_start' && evt.event.content_block?.type === 'tool_use') {
          const block = evt.event.content_block as { id?: string; name?: string }
          cache.streamingTools.push({
            id: block.id || `tool-${Date.now()}-${Math.random()}`,
            name: block.name || 'Unknown',
            input: {},
            status: 'running',
          })
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
            cache.tokenUsage = cache.tokenUsage ? {
              ...cache.tokenUsage,
              subagentInputTokens: (cache.tokenUsage.subagentInputTokens || 0) + usage.input_tokens!,
              subagentOutputTokens: (cache.tokenUsage.subagentOutputTokens || 0) + (usage.output_tokens || 0),
            } : cache.tokenUsage
          } else {
            cache.tokenUsage = {
              inputTokens: usage.input_tokens!,
              outputTokens: usage.output_tokens || 0,
              cacheReadInputTokens: usage.cache_read_input_tokens || 0,
              cacheCreationInputTokens: usage.cache_creation_input_tokens || 0,
              contextWindow: cache.tokenUsage?.contextWindow || 200000,
              subagentInputTokens: cache.tokenUsage?.subagentInputTokens,
              subagentOutputTokens: cache.tokenUsage?.subagentOutputTokens,
            }
          }
        }
        const content = assistantMsg.message?.content
        if (Array.isArray(content)) {
          for (const block of content) {
            const b = block as { type: string; id?: string; name?: string; input?: Record<string, unknown> }
            if (b.type === 'tool_use' && b.id) {
              const idx = cache.streamingTools.findIndex((t) => t.id === b.id)
              if (idx >= 0) {
                cache.streamingTools[idx] = { ...cache.streamingTools[idx], input: b.input || {} }
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
        }
        break
      }
      case 'user': {
        const userMsg = msg as { message?: { content?: unknown[] } }
        const content = userMsg.message?.content
        if (Array.isArray(content)) {
          for (const block of content) {
            const b = block as { type: string; tool_use_id?: string; content?: unknown; is_error?: boolean }
            if (b.type === 'tool_result' && b.tool_use_id) {
              const idx = cache.streamingTools.findIndex((t) => t.id === b.tool_use_id)
              if (idx >= 0) {
                const resultText = typeof b.content === 'string'
                  ? b.content
                  : Array.isArray(b.content)
                    ? (b.content as Array<{ type: string; text?: string }>)
                      .filter((c) => c.type === 'text')
                      .map((c) => c.text || '')
                      .join('\n')
                    : ''
                cache.streamingTools[idx] = {
                  ...cache.streamingTools[idx],
                  result: resultText,
                  isError: b.is_error === true,
                  status: b.is_error ? 'error' : 'done',
                }
              }
            }
          }
        }
        break
      }
      case 'system': {
        const sysMsg = msg as { subtype?: string; status?: string | null; compact_metadata?: { trigger: string; pre_tokens: number } }
        if (sysMsg.subtype === 'status') {
          cache.isCompacting = sysMsg.status === 'compacting'
        } else if (sysMsg.subtype === 'compact_boundary') {
          const tokens = sysMsg.compact_metadata?.pre_tokens
          const label = tokens ? `Context compacted (${Math.round(tokens / 1000)}k tokens summarized)` : 'Context compacted'
          commitCacheTurn(cache)
          cache.messages.push({ id: nextId(), role: 'system', content: label, toolCalls: [] })
        }
        break
      }
      case 'injected_context': {
        const ic = (msg as { injectedContext?: InjectedContext }).injectedContext
        if (ic) {
          const lastUserIdx = cache.messages.findLastIndex((m: ChatMessage) => m.role === 'user')
          if (lastUserIdx >= 0) {
            cache.messages[lastUserIdx] = { ...cache.messages[lastUserIdx], injectedContext: ic }
          }
        }
        break
      }
    }
  }

  // --- The massive event listener effect ---
  useEffect(() => {
    const unsubs: Array<() => void> = []

    unsubs.push(codr.onMessage((raw, querySessionId) => {
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

        codr.getSessionMessages(sessionId).then((rawMessages) => {
          if (activeSessionIdRef.current !== sessionId) return
          const parsed = parseSessionMessages(rawMessages)
          onSessionCapturedRef.current(sessionId, parsed, extractTokenUsageFromRaw(rawMessages))
        }).catch(() => {})
      }

      const activeId = activeSessionIdRef.current

      // Route events for non-active sessions into the background cache
      if (activeId && querySessionId && querySessionId !== activeId) {
        processBackgroundMessage(querySessionId, raw)
        return
      }
      if (!querySessionId && activeId) return
      if (!activeId && querySessionId) return

      setIsLoading(true)

      const isSubagent = !!(raw as { parent_tool_use_id?: string | null }).parent_tool_use_id
      const msg = raw as AgentMessage
      // DEBUG: log all incoming messages to trace [object Object] bug
      if (msg.type === 'stream_event' || msg.type === 'assistant') {
        console.log('[debug:msg]', msg.type, JSON.stringify(msg).slice(0, 400))
      }
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
            const sysMessage: ChatMessage = { id: nextId(), role: 'system', content: label, toolCalls: [] }
            allMessagesRef.current = [...allMessagesRef.current, sysMessage]
            setMessages((prev) => [...prev, sysMessage])
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

    if (codr.onSessionIdentified) {
      unsubs.push(codr.onSessionIdentified(({ oldKey, newKey }) => {
        if (activeSessionIdRef.current === oldKey) {
          activeSessionIdRef.current = newKey
          setActiveSessionId(newKey)
        } else {
          // Re-key background cache entry if a background session's ID changed
          const cache = sessionCacheRef.current.get(oldKey)
          if (cache) {
            sessionCacheRef.current.delete(oldKey)
            sessionCacheRef.current.set(newKey, cache)
          }
        }
      }))
    }

    if (codr.onDraftTitleGenerated) {
      unsubs.push(codr.onDraftTitleGenerated((data, querySessionId) => {
        if (!data?.title || !querySessionId) return
        onDraftTitleGeneratedRef.current(querySessionId, data.title)
      }))
    }

    unsubs.push(codr.onError((error, querySessionId) => {
      if (querySessionId) {
        setBackgroundQuerySessionIds(prev => {
          if (!prev.has(querySessionId)) return prev
          const next = new Set(prev)
          next.delete(querySessionId)
          return next
        })
      }

      const activeId = activeSessionIdRef.current

      // Handle errors for background sessions: update cache
      if (activeId && querySessionId && querySessionId !== activeId) {
        const cache = sessionCacheRef.current.get(querySessionId)
        if (cache) {
          commitCacheTurn(cache)
          cache.messages.push({ id: nextId(), role: 'assistant', content: error, toolCalls: [] })
          cache.isLoading = false
        }
        if (error.includes('can no longer be resumed')) {
          invalidatedSessionsRef.current.add(querySessionId)
        }
        return
      }
      if (!querySessionId && activeId) return
      if (!activeId && querySessionId) return

      errorSessionRef.current = querySessionId || activeSessionIdRef.current

      // Track sessions that can no longer be resumed (e.g. after sleep/wake corruption)
      if (error.includes('can no longer be resumed') && activeSessionIdRef.current) {
        invalidatedSessionsRef.current.add(activeSessionIdRef.current)
      }

      commitCurrentTurn()
      const errorMsg: ChatMessage = { id: nextId(), role: 'assistant', content: error, toolCalls: [] }
      allMessagesRef.current = [...allMessagesRef.current, errorMsg]
      setMessages((prev) => [...prev, errorMsg])
      isLoadingRef.current = false
      setIsLoading(false)

      dialogsRef.current.onDoneWithPlanExit()
      setTimeout(() => onQueueProcessRef.current(), 0)
    }))

    unsubs.push(codr.onDone((querySessionId) => {
      if (querySessionId) {
        setBackgroundQuerySessionIds(prev => {
          if (!prev.has(querySessionId)) return prev
          const next = new Set(prev)
          next.delete(querySessionId)
          return next
        })
      }

      const activeId = activeSessionIdRef.current

      // Handle done for background sessions: finalize cache
      if (activeId && querySessionId && querySessionId !== activeId) {
        const cache = sessionCacheRef.current.get(querySessionId)
        if (cache) {
          commitCacheTurn(cache)
          cache.isLoading = false
          // Async reconciliation: fetch final messages from main process
          codr.getSessionMessages(querySessionId).then((raw) => {
            const existingCache = sessionCacheRef.current.get(querySessionId)
            if (existingCache && activeSessionIdRef.current !== querySessionId) {
              const parsed = reconcileParsedMessages(existingCache.allMessages, parseSessionMessages(raw))
              existingCache.allMessages = parsed
              existingCache.messages = parsed.slice(-PAGE_SIZE)
              const usage = extractTokenUsageFromRaw(raw)
              if (usage) existingCache.tokenUsage = usage
            }
          }).catch(() => {})
        }
        return
      }
      if (!querySessionId && activeId) {
        setTimeout(() => onQueueProcessRef.current(), 0)
        return
      }
      if (!activeId && querySessionId) {
        setTimeout(() => onQueueProcessRef.current(), 0)
        return
      }

      commitCurrentTurn()
      isLoadingRef.current = false
      setIsLoading(false)

      dialogsRef.current.onDoneWithPlanExit()

      const doneSessionId = activeSessionIdRef.current
      const hadError = errorSessionRef.current === doneSessionId
      errorSessionRef.current = null
      if (doneSessionId && !hadError) {
        codr.getSessionMessages(doneSessionId).then((raw) => {
          if (activeSessionIdRef.current !== doneSessionId) return
          // Skip stale reconciliation if a new query has already started (e.g. from queue)
          if (isLoadingRef.current) return
          const parsedRaw = parseSessionMessages(raw)
          const parsed = reconcileParsedMessages(allMessagesRef.current, parsedRaw)
          allMessagesRef.current = parsed
          const initial = parsed.slice(-PAGE_SIZE)
          setMessages(initial)
          setHasMoreMessages(parsed.length > PAGE_SIZE)
          const usage = extractTokenUsageFromRaw(raw)
          if (usage) setTokenUsage(usage)
        }).catch(() => {})
      }

      setTimeout(() => onQueueProcessRef.current(), 0)
    }))

    unsubs.push(codr.onPermissionRequest((request, querySessionId) => {
      if (autoAllowedToolsRef.current.has(request.tool)) {
        codr.respondPermission(request.id, true)
        return
      }
      // ExitPlanMode with embedded plan content (from Cursor provider's cursor/create_plan)
      if (request.tool === 'ExitPlanMode' && (request.input as Record<string, unknown>)?.planContent) {
        const input = request.input as { planContent: string; planFilePath: string; provider?: string }
        dialogsRef.current.onPlanWrite(`cursor-plan-${request.id}`, input.planFilePath, input.planContent, input.provider as import('../../../shared/provider-types').AgentProviderId)
        dialogsRef.current.onExitPlanMode()
      }
      const key = querySessionId || '_unknown'
      dialogsRef.current.onPermissionRequest(key, request)
    }))

    if (codr.onPermissionCleared) {
      unsubs.push(codr.onPermissionCleared((data, querySessionId) => {
        const key = querySessionId || '_unknown'
        dialogsRef.current.onPermissionCleared(key, data.id)
      }))
    }

    if (codr.onQuestionRequest) {
      unsubs.push(codr.onQuestionRequest((request, querySessionId) => {
        const key = querySessionId || '_unknown'
        dialogsRef.current.onQuestionRequest(key, request)
      }))
    }

    if (codr.onQuestionCleared) {
      unsubs.push(codr.onQuestionCleared((data, querySessionId) => {
        const key = querySessionId || '_unknown'
        dialogsRef.current.onQuestionCleared(key, data.id)
      }))
    }

    if (codr.onSessionUpdated) {
      unsubs.push(codr.onSessionUpdated(({ sessionId }) => {
        if (sessionId === activeSessionIdRef.current && !isLoadingRef.current) {
          codr.getSessionMessages(sessionId).then((raw) => {
            const parsed = reconcileParsedMessages(allMessagesRef.current, parseSessionMessages(raw))
            allMessagesRef.current = parsed
            setMessages(parsed.slice(-PAGE_SIZE))
            setHasMoreMessages(parsed.length > PAGE_SIZE)
            const usage = extractTokenUsageFromRaw(raw)
            if (usage) setTokenUsage(usage)
          }).catch(() => {})
        } else {
          // Update background cache if it exists
          const cache = sessionCacheRef.current.get(sessionId)
          if (cache && !cache.isLoading) {
            codr.getSessionMessages(sessionId).then((raw) => {
              const existingCache = sessionCacheRef.current.get(sessionId)
              if (existingCache && !existingCache.isLoading) {
                const parsed = parseSessionMessages(raw)
                existingCache.allMessages = parsed
                existingCache.messages = parsed.slice(-PAGE_SIZE)
              }
            }).catch(() => {})
          }
        }
      }))
    }

    if (codr.onStateSync) {
      unsubs.push(codr.onStateSync((state) => {
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

          // Populate cache for non-active sessions
          for (const [sid, s] of Object.entries(state.activeStates)) {
            if (sid !== activeId) {
              sessionCacheRef.current.set(sid, {
                messages: s.messages || [],
                allMessages: s.messages || [],
                streamingText: s.streamingText || '',
                streamingThinking: s.streamingThinking || '',
                streamingTools: s.streamingTools || [],
                isLoading: s.isLoading,
                isCompacting: s.isCompacting ?? false,
                tokenUsage: s.tokenUsage || null,
              })
            }
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
    if (codr.onWakeRecovery) {
      unsubs.push(codr.onWakeRecovery(() => {
        // Clean up all background caches that were loading
        for (const [, cache] of sessionCacheRef.current.entries()) {
          if (cache.isLoading) {
            commitCacheTurn(cache)
            cache.messages.push({
              id: nextId(), role: 'system',
              content: 'Session interrupted — you can send a new message to continue.',
              toolCalls: [],
            })
            cache.isLoading = false
          }
        }
        setBackgroundQuerySessionIds(new Set())

        if (isLoadingRef.current) {
          commitCurrentTurn()
          const interruptMsg: ChatMessage = { id: nextId(), role: 'system', content: 'Session interrupted — you can send a new message to continue.', toolCalls: [] }
          allMessagesRef.current = [...allMessagesRef.current, interruptMsg]
          setMessages((prev) => [...prev, interruptMsg])
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
    addUserMessage,
    resetStreaming,
    applyStreamingState,
    loadMessages,
    loadMoreMessages,
    saveActiveToCache,
    restoreFromCache,
    reconcileFromDb,
    nextId,
  }
}

export { nextId }
