import type { SessionUpdate, PlanEntry, ContentBlock, AvailableCommand } from '@agentclientprotocol/sdk'
import type { AgentProviderId } from '../../../shared/provider-types'
import type { ProviderRunCallbacks } from '../provider'
import { upsertIndexedSession } from '../session-index'
import { ToolCallState } from './tool-call-state'
import { normalizeAcpTool } from './normalizer'

/**
 * Thin adapter: ACP SessionUpdate → stream events the renderer understands.
 * Unlike the old normalizer, this preserves ALL ACP fields (kind, title, content,
 * locations, rawInput, rawOutput, _meta) on tool blocks.
 */
export class AcpStreamAdapter {
  private agentText = ''
  private reasoningText = ''
  private toolUseBlocks: Array<{
    id: string
    name: string
    kind: string
    title: string
    input: Record<string, unknown>
    content?: Array<{ type: string; [key: string]: unknown }>
    locations?: Array<{ path: string; line?: number | null }>
    rawInput?: unknown
    rawOutput?: unknown
    meta?: Record<string, unknown>
  }> = []
  private toolResultBlocks: Array<{ tool_use_id: string; content: string; is_error: boolean }> = []
  private pendingPlanEntries: PlanEntry[] = []
  private _availableCommands: AvailableCommand[] = []
  private readonly toolCallState = new ToolCallState()

  private readonly providerId: AgentProviderId
  private readonly sessionId: string
  private readonly callbacks: ProviderRunCallbacks

  constructor(providerId: AgentProviderId, sessionId: string, callbacks: ProviderRunCallbacks) {
    this.providerId = providerId
    this.sessionId = sessionId
    this.callbacks = callbacks
  }

  getPendingPlanEntries(): PlanEntry[] {
    return this.pendingPlanEntries
  }

  getAvailableCommands(): AvailableCommand[] {
    return this._availableCommands
  }

  handleUpdate(update: SessionUpdate): void {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        this.handleAgentMessageChunk(update)
        break
      case 'agent_thought_chunk':
        this.handleAgentThoughtChunk(update)
        break
      case 'user_message_chunk':
        // User messages are not streamed to renderer (already displayed)
        break
      case 'tool_call':
        this.handleToolCall(update)
        break
      case 'tool_call_update':
        this.handleToolCallUpdate(update)
        break
      case 'plan':
        this.handlePlan(update)
        break
      case 'session_info_update':
        this.handleSessionInfoUpdate(update)
        break
      case 'usage_update':
        this.handleUsageUpdate(update)
        break
      case 'available_commands_update':
        this.handleAvailableCommandsUpdate(update)
        break
      case 'config_option_update':
      case 'current_mode_update':
        break
    }
  }

  /** Signal turn complete. Emits final assistant message with accumulated content. */
  finalizeTurn(): void {
    const assistantContent: unknown[] = []

    if (this.reasoningText) {
      assistantContent.push({ type: 'thinking', thinking: this.reasoningText })
    }
    if (this.agentText) {
      assistantContent.push({ type: 'text', text: this.agentText })
    }
    for (const block of this.toolUseBlocks) {
      assistantContent.push({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        kind: block.kind,
        title: block.title,
        input: block.input,
        content: block.content,
        locations: block.locations,
        rawInput: block.rawInput,
        rawOutput: block.rawOutput,
        meta: block.meta,
      })
    }

    if (assistantContent.length > 0) {
      this.emit({
        type: 'assistant',
        session_id: this.sessionId,
        message: { content: assistantContent },
      })
    }

    if (this.toolResultBlocks.length > 0) {
      this.emit({
        type: 'user',
        session_id: this.sessionId,
        message: {
          content: this.toolResultBlocks.map(b => ({ type: 'tool_result', ...b })),
        },
      })
    }

    this.agentText = ''
    this.reasoningText = ''
    this.toolUseBlocks.length = 0
    this.toolResultBlocks.length = 0
    this.toolCallState.clear()
  }

  // --- Handlers ---

  private handleAgentMessageChunk(update: SessionUpdate & { sessionUpdate: 'agent_message_chunk' }): void {
    const text = extractText(update.content)
    if (!text) return

    this.agentText += text
    this.emit({
      type: 'stream_event',
      session_id: this.sessionId,
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text },
      },
    })
  }

  private handleAgentThoughtChunk(update: SessionUpdate & { sessionUpdate: 'agent_thought_chunk' }): void {
    const text = extractText(update.content)
    if (!text) return

    this.reasoningText += text
    this.emit({
      type: 'stream_event',
      session_id: this.sessionId,
      event: {
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: text },
      },
    })
  }

  private handleToolCall(update: SessionUpdate & { sessionUpdate: 'tool_call' }): void {
    const { toolCallId, title, rawInput, rawOutput, status, kind, content, locations, _meta } = update
    const resolved = this.toolCallState.resolve(toolCallId, {
      kind,
      title,
      rawInput,
      rawOutput,
      meta: _meta as Record<string, unknown> | undefined,
    })

    const locs = locations as Array<{ path: string; line?: number | null }> | undefined

    const normalized = normalizeAcpTool(
      resolved.kind, resolved.title,
      (resolved.rawInput as Record<string, unknown>) || {},
      locs,
    )

    if (status === 'pending' || status === 'in_progress') {
      this.emit({
        type: 'stream_event',
        session_id: this.sessionId,
        event: {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: toolCallId,
            name: normalized.kind,
            kind: normalized.kind,
            title: resolved.title,
            input: normalized.input,
            content,
            locations,
            meta: resolved.meta,
          },
        },
      })
    }

    if (status === 'completed' || status === 'failed') {
      const contentArr = content as Array<{ type: string; [key: string]: unknown }> | undefined
      const output = extractToolResult(contentArr, resolved.rawOutput)

      this.toolUseBlocks.push({
        id: toolCallId,
        name: normalized.kind,
        kind: normalized.kind,
        title: resolved.title,
        input: normalized.input,
        content: content as Array<{ type: string; [key: string]: unknown }>,
        locations: locs,
        rawInput: resolved.rawInput,
        rawOutput: resolved.rawOutput,
        meta: resolved.meta,
      })
      this.toolResultBlocks.push({
        tool_use_id: toolCallId,
        content: output,
        is_error: status === 'failed',
      })

      this.emit({
        type: 'assistant',
        session_id: this.sessionId,
        message: {
          content: [{
            type: 'tool_use',
            id: toolCallId,
            name: normalized.kind,
            kind: normalized.kind,
            title: resolved.title,
            input: normalized.input,
            content,
            locations,
            rawInput: resolved.rawInput,
            rawOutput: resolved.rawOutput,
            meta: resolved.meta,
          }],
        },
      })
      this.emit({
        type: 'user',
        session_id: this.sessionId,
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: toolCallId,
            content: output,
            is_error: status === 'failed',
          }],
        },
      })
    }
  }

  private handleToolCallUpdate(update: SessionUpdate & { sessionUpdate: 'tool_call_update' }): void {
    const { toolCallId, status, rawInput, rawOutput, content, kind, title, locations, _meta } = update

    if (status === 'completed' || status === 'failed') {
      const resolved = this.toolCallState.resolve(toolCallId, {
        kind: kind ?? undefined,
        title: title ?? undefined,
        rawInput,
        rawOutput,
        meta: _meta as Record<string, unknown> | undefined,
      })
      const locs = locations as Array<{ path: string; line?: number | null }> | undefined
      const normalized = normalizeAcpTool(
        resolved.kind, resolved.title,
        (resolved.rawInput as Record<string, unknown>) || {},
        locs,
      )

      const contentArr = content as Array<{ type: string; [key: string]: unknown }> | undefined
      const outputText = extractToolResult(contentArr, resolved.rawOutput)

      this.emit({
        type: 'assistant',
        session_id: this.sessionId,
        message: {
          content: [{
            type: 'tool_use',
            id: toolCallId,
            name: normalized.kind,
            kind: normalized.kind,
            title: resolved.title,
            input: normalized.input,
            content,
            locations,
            rawInput: resolved.rawInput,
            rawOutput: resolved.rawOutput,
            meta: resolved.meta,
          }],
        },
      })
      this.emit({
        type: 'user',
        session_id: this.sessionId,
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: toolCallId,
            content: outputText,
            is_error: status === 'failed',
          }],
        },
      })
    }
  }

  private handlePlan(update: SessionUpdate & { sessionUpdate: 'plan' }): void {
    this.pendingPlanEntries = update.entries

    const toolId = `plan-${Date.now()}`
    const input = {
      todos: update.entries.map(entry => ({
        content: entry.content,
        status: entry.status || 'pending',
        activeForm: entry.content,
      })),
    }

    this.emit({
      type: 'stream_event',
      session_id: this.sessionId,
      event: {
        type: 'content_block_start',
        content_block: { type: 'tool_use', id: toolId, name: 'TodoWrite', kind: 'TodoWrite', title: 'TodoWrite' },
      },
    })
    this.emit({
      type: 'assistant',
      session_id: this.sessionId,
      message: { content: [{ type: 'tool_use', id: toolId, name: 'TodoWrite', kind: 'TodoWrite', title: 'TodoWrite', input }] },
    })
    this.emit({
      type: 'user',
      session_id: this.sessionId,
      message: {
        content: [{ type: 'tool_result', tool_use_id: toolId, content: 'Plan updated', is_error: false }],
      },
    })
  }

  private handleSessionInfoUpdate(update: SessionUpdate & { sessionUpdate: 'session_info_update' }): void {
    if (update.title) {
      void upsertIndexedSession(this.sessionId, { provider: this.providerId, title: update.title })
    }
  }

  private handleUsageUpdate(update: SessionUpdate & { sessionUpdate: 'usage_update' }): void {
    // Forward usage data to renderer
    this.emit({
      type: 'usage_update',
      session_id: this.sessionId,
      usage: update,
    })
  }

  private handleAvailableCommandsUpdate(update: SessionUpdate & { sessionUpdate: 'available_commands_update' }): void {
    const cmds = (update as unknown as { availableCommands?: AvailableCommand[] }).availableCommands || []
    this._availableCommands = cmds
    this.emit({
      type: 'available_commands',
      session_id: this.sessionId,
      commands: cmds.map(c => ({
        name: c.name,
        description: c.description,
        hint: (c.input as { hint?: string } | null)?.hint,
      })),
      provider: this.providerId,
    })
  }

  private emit(message: unknown): void {
    this.callbacks.onMessage(message, this.sessionId)
  }
}

function extractText(content: ContentBlock): string {
  if (content.type === 'text') return (content as { text: string }).text
  return ''
}

/**
 * Build a result string from ACP tool output. Content blocks contain the actual
 * output (file contents, search results, diffs); rawOutput is metadata.
 * Prefer content block text over stringified rawOutput.
 */
export function extractToolResult(
  contentBlocks: Array<{ type: string; [key: string]: unknown }> | undefined,
  rawOutput: unknown,
): string {
  // Extract text from content blocks first — they have the actual output
  if (contentBlocks && contentBlocks.length > 0) {
    const texts: string[] = []
    for (const c of contentBlocks) {
      if (c.type === 'content' && 'content' in c) {
        const inner = c.content as { type?: string; text?: string } | undefined
        if (inner?.type === 'text' && inner.text) texts.push(inner.text)
      } else if (c.type === 'text' && typeof c.text === 'string') {
        texts.push(c.text as string)
      } else if (c.type === 'diff') {
        const path = (c as { path?: string }).path || ''
        const diffContent = (c as { content?: string }).content
        if (diffContent) texts.push(diffContent)
        else texts.push(`[diff: ${path}]`)
      } else if (c.type === 'terminal' && typeof c.content === 'string') {
        texts.push(c.content as string)
      }
    }
    if (texts.length > 0) return texts.join('\n')
  }

  // Fall back to rawOutput — unwrap intelligently
  if (rawOutput != null) {
    if (typeof rawOutput === 'string') return rawOutput
    if (typeof rawOutput === 'object') {
      const ro = rawOutput as Record<string, unknown>
      // Read tool: rawOutput is { content: "file contents..." } — unwrap
      if (typeof ro.content === 'string') return ro.content
      // Search tools: rawOutput is { totalFiles: N, truncated: bool } or { totalMatches: N }
      const parts: string[] = []
      if (typeof ro.totalFiles === 'number') parts.push(`${ro.totalFiles} files found`)
      if (typeof ro.totalMatches === 'number') parts.push(`${ro.totalMatches} matches found`)
      if (ro.truncated === true) parts.push('(truncated)')
      if (parts.length > 0) return parts.join(', ')
    }
    return JSON.stringify(rawOutput)
  }
  return ''
}
