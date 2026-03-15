import type { BrowserWindow } from 'electron'
import type { RelayClient } from './relay-client'
import type { ChatMessage, ToolCallInfo, PlanReviewState } from './types'

// Map IPC channel names to relay WebSocket message types
const CHANNEL_TO_WS_TYPE: Record<string, string> = {
  'agent:message': 'agent_message',
  'agent:error': 'agent_error',
  'agent:done': 'agent_done',
  'agent:permission-request': 'permission_request',
  'agent:question-request': 'question_request',
  'sessions:refresh-hint': 'sessions_refresh_hint',
  'sessions:session-updated': 'session_updated',
  'agent:permission-cleared': 'permission_cleared',
  'agent:question-cleared': 'question_cleared',
  'docs:crawl-progress': 'doc_crawl_progress',
  'docs:setup-progress': 'setup_progress',
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  contextWindow: number
  subagentInputTokens?: number
  subagentOutputTokens?: number
}

export interface ConversationState {
  messages: ChatMessage[]
  isLoading: boolean
  isCompacting: boolean
  streamingText: string
  streamingThinking: string
  streamingTools: ToolCallInfo[]
  permissionRequest: { id: number; tool: string; input: unknown } | null
  questionRequest: { id: number; questions: unknown[] } | null
  planReview: PlanReviewState | null
  querySessionId: string | null
  tokenUsage: TokenUsage | null
}

function createEmptyState(querySessionId: string | null = null): ConversationState {
  return {
    messages: [],
    isLoading: false,
    isCompacting: false,
    streamingText: '',
    streamingThinking: '',
    streamingTools: [],
    permissionRequest: null,
    questionRequest: null,
    planReview: null,
    querySessionId,
    tokenUsage: null,
  }
}

export class EventBroadcaster {
  private getMainWindow: () => BrowserWindow | null
  private relayClient: RelayClient | null = null

  // Per-session state tracking for concurrent queries
  private states = new Map<string, ConversationState>()
  private lastPlanWrites = new Map<string, { filePath: string; content: string }>()
  private mostRecentQueryKey: string | null = null

  constructor(getMainWindow: () => BrowserWindow | null) {
    this.getMainWindow = getMainWindow
  }

  setRelayClient(client: RelayClient | null) {
    this.relayClient = client
  }

  send(channel: string, data?: unknown, querySessionId?: string | null) {
    const qsid = querySessionId ?? null

    // Send to Electron renderer via IPC (include querySessionId as third arg)
    const win = this.getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, data, qsid)
    }

    // Send to relay for web clients (include querySessionId in payload)
    const wsType = CHANNEL_TO_WS_TYPE[channel]
    if (wsType && this.relayClient?.isConnected()) {
      if (channel === 'agent:message') {
        this.relayClient.send({ type: wsType, message: data, querySessionId: qsid })
      } else if (channel === 'agent:error') {
        this.relayClient.send({ type: wsType, error: data, querySessionId: qsid })
      } else if (channel === 'agent:permission-request' || channel === 'agent:question-request') {
        this.relayClient.send({ type: wsType, ...(data as Record<string, unknown>), querySessionId: qsid })
      } else if (channel === 'agent:permission-cleared' || channel === 'agent:question-cleared') {
        this.relayClient.send({ type: wsType, ...(data as Record<string, unknown>), querySessionId: qsid })
      } else if (channel === 'sessions:session-updated') {
        this.relayClient.send({ type: wsType, ...(data as Record<string, unknown>) })
      } else if (channel === 'docs:crawl-progress') {
        this.relayClient.send({ type: wsType, ...(data as Record<string, unknown>) })
      } else if (channel === 'docs:setup-progress') {
        this.relayClient.send({ type: wsType, ...(data as Record<string, unknown>) })
      } else {
        this.relayClient.send({ type: wsType, querySessionId: qsid })
      }
    }

    // Track state for state_sync (only for session-scoped channels)
    if (qsid) {
      this.trackState(channel, data, qsid)
    }
  }

  private trackState(channel: string, data: unknown, querySessionId: string) {
    const state = this.states.get(querySessionId)
    if (!state) return

    switch (channel) {
      case 'agent:message': {
        const msg = data as { type: string; [key: string]: unknown }
        if (msg.type === 'stream_event') {
          const evt = msg as {
            type: string
            event: {
              type: string
              index?: number
              delta?: { type: string; text?: string; thinking?: string }
              content_block?: { type: string; id?: string; name?: string }
            }
          }
          if (evt.event.type === 'content_block_delta' && evt.event.delta?.type === 'text_delta' && evt.event.delta.text) {
            // New text after tools = new agent turn boundary
            if (state.streamingTools.length > 0) {
              this.commitCurrentTurn(querySessionId)
            }
            state.streamingText += evt.event.delta.text
          } else if (evt.event.type === 'content_block_delta' && evt.event.delta?.type === 'thinking_delta' && evt.event.delta.thinking) {
            state.streamingThinking += evt.event.delta.thinking
          } else if (evt.event.type === 'content_block_start' && evt.event.content_block?.type === 'tool_use') {
            const block = evt.event.content_block
            state.streamingTools.push({
              id: block.id || `tool-${Date.now()}-${Math.random()}`,
              name: block.name || 'Unknown',
              input: {},
              status: 'running',
            })
          }
        } else if (msg.type === 'assistant') {
          // Extract token usage from assistant message
          const isSubagent = !!(msg as { parent_tool_use_id?: string | null }).parent_tool_use_id
          const usageMsg = msg as { message?: { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } } }
          const usage = usageMsg.message?.usage
          if (usage?.input_tokens) {
            if (isSubagent) {
              // Accumulate subagent tokens separately
              state.tokenUsage = {
                ...state.tokenUsage!,
                subagentInputTokens: (state.tokenUsage?.subagentInputTokens || 0) + usage.input_tokens,
                subagentOutputTokens: (state.tokenUsage?.subagentOutputTokens || 0) + (usage.output_tokens || 0),
              }
            } else {
              state.tokenUsage = {
                inputTokens: usage.input_tokens,
                outputTokens: usage.output_tokens || 0,
                cacheReadInputTokens: usage.cache_read_input_tokens || 0,
                cacheCreationInputTokens: usage.cache_creation_input_tokens || 0,
                contextWindow: state.tokenUsage?.contextWindow || 200000,
                subagentInputTokens: state.tokenUsage?.subagentInputTokens,
                subagentOutputTokens: state.tokenUsage?.subagentOutputTokens,
              }
            }
          }
          // Full assistant message — extract complete tool_use blocks with input
          const assistantMsg = msg as { message?: { content?: Array<{ type: string; id?: string; name?: string; input?: Record<string, unknown> }> } }
          const content = assistantMsg.message?.content
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'tool_use' && block.id) {
                const idx = state.streamingTools.findIndex((t) => t.id === block.id)
                if (idx >= 0) {
                  state.streamingTools[idx] = {
                    ...state.streamingTools[idx],
                    input: block.input || {},
                  }
                }

                // Track Write calls to .claude/plans/
                if (block.name === 'Write') {
                  const filePath = block.input?.file_path as string
                  if (filePath?.includes('.claude/plans/')) {
                    this.lastPlanWrites.set(querySessionId, {
                      filePath,
                      content: block.input?.content as string,
                    })
                  }
                }

                // Detect ExitPlanMode
                const lastPlanWrite = this.lastPlanWrites.get(querySessionId)
                if (block.name === 'ExitPlanMode' && lastPlanWrite) {
                  state.planReview = {
                    planFilePath: lastPlanWrite.filePath,
                    planContent: lastPlanWrite.content,
                    allowedPrompts: block.input?.allowedPrompts as Array<{ tool: string; prompt: string }> | undefined,
                    provider: 'claude',
                    sourceSessionId: querySessionId,
                  }
                }
              }
            }
          }
        } else if (msg.type === 'system') {
          const sysMsg = msg as { type: string; subtype?: string; status?: string | null; compact_metadata?: { trigger: string; pre_tokens: number } }
          if (sysMsg.subtype === 'status') {
            state.isCompacting = sysMsg.status === 'compacting'
          } else if (sysMsg.subtype === 'compact_boundary') {
            const tokens = sysMsg.compact_metadata?.pre_tokens
            const label = tokens ? `Context compacted (${Math.round(tokens / 1000)}k tokens summarized)` : 'Context compacted'
            state.messages.push({
              id: `compact-${Date.now()}`,
              role: 'system',
              content: label,
              toolCalls: [],
            })
          }
        } else if (msg.type === 'user') {
          // User message — extract tool_result blocks with tool output
          const userMsg = msg as { message?: { content?: Array<{ type: string; tool_use_id?: string; content?: unknown; is_error?: boolean }> } }
          const content = userMsg.message?.content
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'tool_result' && block.tool_use_id) {
                const idx = state.streamingTools.findIndex((t) => t.id === block.tool_use_id)
                if (idx >= 0) {
                  const resultText = typeof block.content === 'string'
                    ? block.content
                    : Array.isArray(block.content)
                      ? (block.content as Array<{ type: string; text?: string }>)
                        .filter((c) => c.type === 'text')
                        .map((c) => c.text || '')
                        .join('\n')
                      : ''
                  state.streamingTools[idx] = {
                    ...state.streamingTools[idx],
                    result: resultText,
                    isError: block.is_error === true,
                    status: block.is_error ? 'error' : 'done',
                  }
                }
              }
            }
          }
        }
        break
      }
      case 'agent:done': {
        this.commitCurrentTurn(querySessionId)
        this.states.delete(querySessionId)
        this.lastPlanWrites.delete(querySessionId)
        if (this.mostRecentQueryKey === querySessionId) {
          this.mostRecentQueryKey = null
        }
        break
      }
      case 'agent:error': {
        this.commitCurrentTurn(querySessionId)
        this.states.delete(querySessionId)
        this.lastPlanWrites.delete(querySessionId)
        if (this.mostRecentQueryKey === querySessionId) {
          this.mostRecentQueryKey = null
        }
        break
      }
      case 'agent:permission-request': {
        state.permissionRequest = data as { id: number; tool: string; input: unknown }
        break
      }
      case 'agent:question-request': {
        state.questionRequest = data as { id: number; questions: unknown[] }
        break
      }
    }
  }

  /** Called when a new query starts */
  markQueryStart(queryKey: string, prompt: string) {
    const state = createEmptyState(queryKey)
    state.messages.push({
      id: `msg-${Date.now()}`,
      role: 'user',
      content: prompt,
      toolCalls: [],
    })
    state.isLoading = true
    this.states.set(queryKey, state)
    this.mostRecentQueryKey = queryKey
  }

  /** Called when the real session ID arrives for a new session */
  updateQuerySessionId(oldKey: string, newKey: string) {
    const state = this.states.get(oldKey)
    if (state) {
      state.querySessionId = newKey
      this.states.delete(oldKey)
      this.states.set(newKey, state)
    }
    const planWrite = this.lastPlanWrites.get(oldKey)
    if (planWrite) {
      this.lastPlanWrites.delete(oldKey)
      this.lastPlanWrites.set(newKey, planWrite)
    }
    if (this.mostRecentQueryKey === oldKey) {
      this.mostRecentQueryKey = newKey
    }

    // Notify renderer so it can stop filtering live stream events by stale draft/new IDs.
    const win = this.getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('agent:session-identified', { oldKey, newKey })
    }
  }

  private commitCurrentTurn(querySessionId: string) {
    const state = this.states.get(querySessionId)
    if (!state) return

    const text = state.streamingText
    const tools = state.streamingTools
    const thinking = state.streamingThinking

    if (text || tools.length > 0 || thinking) {
      const last = state.messages[state.messages.length - 1]
      if (!text && tools.length > 0 && last?.role === 'assistant') {
        // Tool-only turn: merge into previous assistant message
        last.toolCalls.push(...tools)
        if (!last.thinking && thinking) last.thinking = thinking
      } else {
        state.messages.push({
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: text,
          toolCalls: [...tools],
          thinking: thinking || undefined,
        })
      }
    }

    state.streamingText = ''
    state.streamingThinking = ''
    state.streamingTools = []
  }

  getLastPlanInfo(sessionId?: string): { filePath: string; content: string } | null {
    const key = sessionId || this.mostRecentQueryKey
    if (key) {
      const state = this.states.get(key)
      if (state?.planReview) {
        return { filePath: state.planReview.planFilePath, content: state.planReview.planContent }
      }
      return this.lastPlanWrites.get(key) || null
    }
    return null
  }

  getState(sessionId?: string): ConversationState {
    const key = sessionId || this.mostRecentQueryKey
    if (key) {
      const state = this.states.get(key)
      if (state) {
        return {
          ...state,
          messages: [...state.messages],
          streamingTools: [...state.streamingTools],
        }
      }
    }
    return createEmptyState()
  }

  /** Clear a question request after the user responds */
  clearQuestionRequest(questionId: number) {
    for (const state of this.states.values()) {
      if (state.questionRequest?.id === questionId) {
        state.questionRequest = null
        this.send('agent:question-cleared', { id: questionId }, state.querySessionId)
        break
      }
    }
  }

  /** Clear a permission request after the user responds */
  clearPermissionRequest(permissionId: number) {
    for (const state of this.states.values()) {
      if (state.permissionRequest?.id === permissionId) {
        state.permissionRequest = null
        this.send('agent:permission-cleared', { id: permissionId }, state.querySessionId)
        break
      }
    }
  }

  forceCleanup(querySessionId: string, errorMessage: string) {
    const hadState = this.states.has(querySessionId)
    if (hadState) {
      this.commitCurrentTurn(querySessionId)
      this.states.delete(querySessionId)
    }
    this.lastPlanWrites.delete(querySessionId)
    if (this.mostRecentQueryKey === querySessionId) {
      this.mostRecentQueryKey = null
    }
    this.send('agent:error', errorMessage, querySessionId)
    this.send('agent:done', undefined, querySessionId)
  }

  /** Check if any queries are currently active */
  hasActiveQueries(): boolean {
    return this.states.size > 0
  }

  sendStateSync() {
    if (this.relayClient?.isConnected()) {
      // Send all active session states for multi-session support
      const activeStates: Record<string, ConversationState> = {}
      for (const [key, state] of this.states) {
        activeStates[key] = {
          ...state,
          messages: [...state.messages],
          streamingTools: [...state.streamingTools],
        }
      }
      this.relayClient.send({ type: 'state_sync', activeStates })
    }
  }
}
