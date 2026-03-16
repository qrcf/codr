import type { SessionUpdate, PlanEntry, ContentBlock } from '@agentclientprotocol/sdk'
import type { ProviderRunCallbacks } from '../../provider'
import { upsertIndexedSession } from '../../session-index'

// ============================================================================
// Tool call normalization (merged from shared/tool-mapping.ts)
// ============================================================================

const CANONICAL_NAMES = new Set([
  'Bash', 'Read', 'Edit', 'Write', 'Grep', 'Glob',
  'WebSearch', 'WebFetch', 'NotebookEdit',
  'Agent', 'TodoWrite', 'EnterPlanMode', 'ExitPlanMode', 'AskUserQuestion',
])

export interface NormalizedToolCall {
  name: string
  input: Record<string, unknown>
}

export interface ToolCallData {
  /** Tool name (Claude canonical) or ACP human-readable title */
  name: string
  /** Raw input from the provider */
  input: Record<string, unknown>
  /** ACP-specific: tool kind */
  kind?: string | null
  /** ACP-specific: tool call content (diffs, terminal output, etc.) */
  content?: AcpToolCallContent[] | null
  /** ACP-specific: file locations */
  locations?: AcpToolCallLocation[] | null
}

interface AcpToolCallContent {
  type: string
  oldText?: string | null
  newText?: string
  path?: string
  content?: { type: string; text?: string }
  terminalId?: string
  [key: string]: unknown
}

interface AcpToolCallLocation {
  path: string
  line?: number | null
}

/**
 * Normalize a tool call from any provider to Codr's canonical format.
 *
 * For Claude: name is already canonical, input is already structured → pass-through.
 * For Cursor/ACP: maps title/kind → canonical name, synthesizes input from ACP metadata.
 */
export function normalizeToolCall(data: ToolCallData): NormalizedToolCall {
  const { name, input } = data

  // Fast path: already a canonical Codr name → pass-through
  if (CANONICAL_NAMES.has(name)) {
    return { name, input }
  }

  // Non-canonical name → needs ACP normalization
  return normalizeFromAcp(name, input, data.kind, data.content, data.locations)
}

function normalizeFromAcp(
  title: string,
  existingInput: Record<string, unknown>,
  kind?: string | null,
  content?: AcpToolCallContent[] | null,
  locations?: AcpToolCallLocation[] | null,
): NormalizedToolCall {
  const hasInput = Object.keys(existingInput).length > 0

  // Priority 1: If input has known Claude keys, infer name from those
  if (hasInput) {
    const name = inferNameFromInput(existingInput)
    if (name) return { name, input: existingInput }
  }

  // Priority 2: Map by ACP kind
  if (kind) {
    const result = mapByKind(kind, title, existingInput, content, locations)
    if (result) return result
  }

  // Priority 3: Title heuristics
  const result = mapByTitle(title, existingInput, locations)
  if (result) return result

  // Fallback: preserve original title as name
  return { name: title, input: existingInput }
}

function inferNameFromInput(input: Record<string, unknown>): string | null {
  if ('command' in input) return 'Bash'
  if ('old_string' in input && 'new_string' in input) return 'Edit'
  if ('content' in input && 'file_path' in input && !('old_string' in input)) return 'Write'
  if ('pattern' in input && !('url' in input)) return 'Grep'
  if ('todos' in input) return 'TodoWrite'
  if ('query' in input) return 'WebSearch'
  if ('url' in input) return 'WebFetch'
  if ('description' in input && !('file_path' in input)) return 'Agent'
  return null
}

function mapByKind(
  kind: string,
  title: string,
  existingInput: Record<string, unknown>,
  content?: AcpToolCallContent[] | null,
  locations?: AcpToolCallLocation[] | null,
): NormalizedToolCall | null {
  const hasInput = Object.keys(existingInput).length > 0

  switch (kind) {
    case 'execute': {
      const input = hasInput ? existingInput : { command: extractCommandFromTitle(title) }
      return { name: 'Bash', input }
    }
    case 'read': {
      const filePath = locations?.[0]?.path || ''
      const input = hasInput ? existingInput : { file_path: filePath }
      return { name: 'Read', input }
    }
    case 'edit': {
      const diff = findDiff(content)
      if (diff) {
        if (diff.oldText == null) {
          const input = hasInput
            ? existingInput
            : { file_path: diff.path || locations?.[0]?.path || '', content: diff.newText || '' }
          return { name: 'Write', input }
        }
        const input = hasInput
          ? existingInput
          : { file_path: diff.path || locations?.[0]?.path || '', old_string: diff.oldText || '', new_string: diff.newText || '' }
        return { name: 'Edit', input }
      }
      const filePath = locations?.[0]?.path || ''
      const input = hasInput ? existingInput : { file_path: filePath }
      return { name: 'Edit', input }
    }
    case 'delete': {
      const filePath = locations?.[0]?.path || ''
      const input = hasInput ? existingInput : { command: `rm ${filePath}`, description: title }
      return { name: 'Bash', input }
    }
    case 'move': {
      const input = hasInput ? existingInput : { command: title, description: title }
      return { name: 'Bash', input }
    }
    case 'search': {
      const lower = title.toLowerCase()
      if (lower.includes('web')) {
        const query = extractAfterColon(title) || title
        const input = hasInput ? existingInput : { query }
        return { name: 'WebSearch', input }
      }
      const pattern = extractAfterColon(title) || title
      const input = hasInput ? existingInput : { pattern }
      return { name: 'Grep', input }
    }
    case 'fetch': {
      const url = extractUrl(title) || title
      const input = hasInput ? existingInput : { url }
      return { name: 'WebFetch', input }
    }
    case 'think':
      return { name: 'Agent', input: hasInput ? existingInput : { description: title } }
    case 'switch_mode':
      return null // Handled separately by cursor provider
    case 'other':
    default:
      return null
  }
}

function mapByTitle(
  title: string,
  existingInput: Record<string, unknown>,
  locations?: AcpToolCallLocation[] | null,
): NormalizedToolCall | null {
  const hasInput = Object.keys(existingInput).length > 0
  const lower = title.toLowerCase()
  const trimmed = title.trim()

  // Backtick-wrapped command: `cd /path && pnpm build`
  if (trimmed.startsWith('`') && trimmed.endsWith('`')) {
    const command = trimmed.slice(1, -1)
    return { name: 'Bash', input: hasInput ? existingInput : { command } }
  }

  if (lower.startsWith('run ') || lower.startsWith('execute ')) {
    const command = extractCommandFromTitle(title)
    return { name: 'Bash', input: hasInput ? existingInput : { command } }
  }

  if (lower.includes('web search') || lower.includes('search web')) {
    const query = extractAfterColon(title) || title
    return { name: 'WebSearch', input: hasInput ? existingInput : { query } }
  }

  if (lower.startsWith('read ') && (title.includes('/') || title.includes('.'))) {
    const filePath = locations?.[0]?.path || title.replace(/^read\s+/i, '').trim()
    return { name: 'Read', input: hasInput ? existingInput : { file_path: filePath } }
  }

  if (lower.startsWith('edit ') && (title.includes('/') || title.includes('.'))) {
    const filePath = locations?.[0]?.path || title.replace(/^edit\s+/i, '').trim()
    return { name: 'Edit', input: hasInput ? existingInput : { file_path: filePath } }
  }

  if (lower.startsWith('write ') && (title.includes('/') || title.includes('.'))) {
    const filePath = locations?.[0]?.path || title.replace(/^write\s+/i, '').trim()
    return { name: 'Write', input: hasInput ? existingInput : { file_path: filePath } }
  }

  if (lower.startsWith('fetch ') || /https?:\/\//.test(title)) {
    const url = extractUrl(title) || title
    return { name: 'WebFetch', input: hasInput ? existingInput : { url } }
  }

  if (lower.startsWith('search ') || lower.startsWith('grep ') || lower.startsWith('find ')) {
    const pattern = extractAfterColon(title) || title.replace(/^(search|grep|find)\s+/i, '').trim()
    return { name: 'Grep', input: hasInput ? existingInput : { pattern } }
  }

  if (lower.startsWith('list ') || lower.startsWith('glob ')) {
    const pattern = title.replace(/^(list|glob)\s+/i, '').trim()
    return { name: 'Glob', input: hasInput ? existingInput : { pattern } }
  }

  return null
}

function extractCommandFromTitle(title: string): string {
  const trimmed = title.trim()
  if (trimmed.startsWith('`') && trimmed.endsWith('`')) return trimmed.slice(1, -1)
  return trimmed.replace(/^(run|execute)\s+/i, '').trim()
}

function extractAfterColon(title: string): string {
  const idx = title.indexOf(':')
  if (idx >= 0) return title.slice(idx + 1).trim()
  return ''
}

function extractUrl(title: string): string {
  const match = title.match(/https?:\/\/[^\s"'<>]+/)
  return match?.[0] || ''
}

function findDiff(content?: AcpToolCallContent[] | null): { oldText?: string | null; newText?: string; path?: string } | null {
  if (!content) return null
  for (const c of content) {
    if (c.type === 'diff') return { oldText: c.oldText, newText: c.newText || '', path: c.path || '' }
  }
  return null
}

// ============================================================================
// ACP event normalizer
// ============================================================================

/**
 * Normalizes ACP session/update events into Codr's Claude-SDK-shaped message format.
 *
 * Operates in two modes:
 * - 'streaming': emits events through callbacks for live rendering (used during runQuery)
 * - 'batch': accumulates messages into an array (used during session/load replay)
 */
export type NormalizerMode = 'streaming' | 'batch'

export class CursorEventNormalizer {
  private agentText = ''
  private reasoningText = ''
  private toolUseBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = []
  private toolResultBlocks: Array<{ tool_use_id: string; content: string; is_error: boolean }> = []
  private pendingPlanEntries: PlanEntry[] = []
  /** Tracks toolCallId → canonical tool name for tool_call_update lookups */
  private toolNameMap = new Map<string, string>()

  private readonly sessionId: string
  private readonly mode: NormalizerMode
  private readonly callbacks?: ProviderRunCallbacks
  private readonly batchMessages: unknown[] = []
  private suppressUserMessages = false

  constructor(sessionId: string, mode: NormalizerMode, callbacks?: ProviderRunCallbacks, opts?: { suppressUserMessages?: boolean }) {
    this.sessionId = sessionId
    this.mode = mode
    this.callbacks = callbacks
    this.suppressUserMessages = opts?.suppressUserMessages ?? false
  }

  /** Get accumulated messages (batch mode only) */
  getMessages(): unknown[] {
    return this.batchMessages
  }

  /** Get accumulated plan entries for cursor/create_plan mapping */
  getPendingPlanEntries(): PlanEntry[] {
    return this.pendingPlanEntries
  }


  /** Process a single ACP session/update notification */
  handleUpdate(update: SessionUpdate): void {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        this.handleAgentMessageChunk(update)
        break
      case 'agent_thought_chunk':
        this.handleAgentThoughtChunk(update)
        break
      case 'user_message_chunk':
        this.handleUserMessageChunk(update)
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
      case 'config_option_update':
      case 'available_commands_update':
      case 'current_mode_update':
        // Not mapped to chat messages
        break
    }
  }

  /** Signal that the agent's turn is complete. Emits canonical assistant message. */
  finalizeTurn(): void {
    const assistantContent: unknown[] = []

    if (this.reasoningText) {
      assistantContent.push({ type: 'thinking', thinking: this.reasoningText })
    }
    if (this.agentText) {
      assistantContent.push({ type: 'text', text: this.agentText })
    }
    for (const block of this.toolUseBlocks) {
      assistantContent.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input })
    }

    if (assistantContent.length > 0) {
      this.emitMessage({
        type: 'assistant',
        session_id: this.sessionId,
        message: { content: assistantContent },
      })
    }

    if (this.toolResultBlocks.length > 0) {
      this.emitMessage({
        type: 'user',
        session_id: this.sessionId,
        message: {
          content: this.toolResultBlocks.map(b => ({ type: 'tool_result', ...b })),
        },
      })
    }

    // Reset accumulators for next turn
    this.agentText = ''
    this.reasoningText = ''
    this.toolUseBlocks.length = 0
    this.toolResultBlocks.length = 0
  }

  // --- Individual update handlers ---

  private handleAgentMessageChunk(update: SessionUpdate & { sessionUpdate: 'agent_message_chunk' }): void {
    const text = extractText(update.content)
    if (!text) return

    this.agentText += text
    this.emitMessage({
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
    this.emitMessage({
      type: 'stream_event',
      session_id: this.sessionId,
      event: {
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: text },
      },
    })
  }

  private handleUserMessageChunk(update: SessionUpdate & { sessionUpdate: 'user_message_chunk' }): void {
    if (this.suppressUserMessages) return

    const text = extractText(update.content)
    if (!text) return

    this.emitMessage({
      type: 'user',
      session_id: this.sessionId,
      message: { content: [{ type: 'text', text }] },
    })
  }

  private handleToolCall(update: SessionUpdate & { sessionUpdate: 'tool_call' }): void {
    const { toolCallId, title, rawInput, rawOutput, status } = update
    // ACP ToolCall also provides kind, content, locations for normalization
    const kind = (update as { kind?: string }).kind
    const toolContent = (update as { content?: Array<{ type: string; [key: string]: unknown }> }).content
    const locations = (update as { locations?: Array<{ path: string; line?: number | null }> }).locations

    const normalized = normalizeToolCall({
      name: title,
      input: (rawInput as Record<string, unknown>) || {},
      kind,
      content: toolContent,
      locations,
    })
    this.toolNameMap.set(toolCallId, normalized.name)

    if (status === 'pending' || status === 'in_progress') {
      // Announce tool call start
      this.emitMessage({
        type: 'stream_event',
        session_id: this.sessionId,
        event: {
          type: 'content_block_start',
          content_block: { type: 'tool_use', id: toolCallId, name: normalized.name },
        },
      })
    }

    if (status === 'completed' || status === 'failed') {
      const input = Object.keys(normalized.input).length > 0
        ? normalized.input
        : (rawInput as Record<string, unknown>) || {}
      const output = rawOutput != null ? (typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput)) : ''

      this.toolUseBlocks.push({ id: toolCallId, name: normalized.name, input })
      this.toolResultBlocks.push({
        tool_use_id: toolCallId,
        content: output,
        is_error: status === 'failed',
      })

      this.emitMessage({
        type: 'assistant',
        session_id: this.sessionId,
        message: { content: [{ type: 'tool_use', id: toolCallId, name: normalized.name, input }] },
      })
      this.emitMessage({
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
    const { toolCallId, status, rawOutput, content } = update

    if (status === 'completed' || status === 'failed') {
      // Extract text from ToolCallContent[] or use rawOutput
      let outputText = ''
      if (rawOutput != null) {
        outputText = typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput)
      } else if (content) {
        outputText = content.map(c => {
          if (c.type === 'content' && c.content.type === 'text') return c.content.text
          if (c.type === 'diff') return `[diff: ${(c as { path?: string }).path}]`
          return ''
        }).join('')
      }

      this.emitMessage({
        type: 'assistant',
        session_id: this.sessionId,
        message: { content: [{ type: 'tool_use', id: toolCallId, name: 'tool_update' }] },
      })
      this.emitMessage({
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

    // Emit as TodoWrite tool_use (same pattern as todo_list)
    const toolId = `plan-${Date.now()}`
    const input = {
      todos: update.entries.map(entry => ({
        content: entry.content,
        status: entry.status || 'pending',
        activeForm: entry.content,
      })),
    }

    this.emitMessage({
      type: 'stream_event',
      session_id: this.sessionId,
      event: {
        type: 'content_block_start',
        content_block: { type: 'tool_use', id: toolId, name: 'TodoWrite' },
      },
    })
    this.emitMessage({
      type: 'assistant',
      session_id: this.sessionId,
      message: { content: [{ type: 'tool_use', id: toolId, name: 'TodoWrite', input }] },
    })
    this.emitMessage({
      type: 'user',
      session_id: this.sessionId,
      message: {
        content: [{ type: 'tool_result', tool_use_id: toolId, content: 'Plan updated', is_error: false }],
      },
    })
  }

  private handleSessionInfoUpdate(update: SessionUpdate & { sessionUpdate: 'session_info_update' }): void {
    if (update.title) {
      void upsertIndexedSession(this.sessionId, { provider: 'cursor', title: update.title })
    }
  }

  // --- Message emission ---

  private emitMessage(message: unknown): void {
    if (this.mode === 'batch') {
      this.batchMessages.push(message)
    } else if (this.callbacks) {
      this.callbacks.onMessage(message, this.sessionId)
    }
  }
}

// --- Helpers ---

function extractText(content: ContentBlock): string {
  if (content.type === 'text') return content.text
  return ''
}
