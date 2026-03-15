import type { ChatMessage, ToolCallInfo, InjectedContext } from '../types'

let parseIdCounter = 0
function nextParseId() {
  return `parsed-${++parseIdCounter}`
}

interface ContentBlock {
  type: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: unknown
}

export function parseSessionMessages(raw: RawSessionMessage[]): ChatMessage[] {
  const result: ChatMessage[] = []

  // Collect tool results from user messages (tool_result blocks)
  const toolResults = new Map<string, { content: string; isError: boolean }>()
  for (const msg of raw) {
    // Skip sub-agent internal messages — they're already shown inside AgentCard
    if (msg.parent_tool_use_id) continue
    if (msg.type === 'user') {
      const content = extractContentBlocks(msg.message)
      for (const block of content) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          const text = typeof block.content === 'string'
            ? block.content
            : Array.isArray(block.content)
              ? (block.content as ContentBlock[])
                .filter((b) => b.type === 'text')
                .map((b) => b.text || '')
                .join('\n')
              : ''
          toolResults.set(block.tool_use_id, {
            content: text,
            isError: (msg.message as Record<string, unknown>).is_error === true,
          })
        }
      }
    }
  }

  const ASK_MODE_PREFIX = '[ASK MODE] You are in Ask mode. Your job is to ANSWER the user\'s question \u2014 do NOT edit any code, create files, or make changes. Only read, search, and explain. Do not use Edit, Write, or NotebookEdit tools.\n\n'
  const PLAN_CHANGE_PREFIX = 'The user requested changes to the plan:\n\n'

  for (const msg of raw) {
    // Skip sub-agent internal messages — they're already shown inside AgentCard
    if (msg.parent_tool_use_id) continue
    const content = extractContentBlocks(msg.message)

    if (msg.type === 'user') {
      // Extract text from user messages, skip tool_result blocks
      const textParts: string[] = []
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          textParts.push(block.text)
        }
      }
      let text = textParts.join('\n')
      if (text) {
        // Clean up system-generated prompt wrappers
        if (text.startsWith('User has approved your plan.')) {
          text = 'Plan approved. Proceed with implementation.'
        } else if (text.startsWith(PLAN_CHANGE_PREFIX)) {
          text = text.slice(PLAN_CHANGE_PREFIX.length)
        }
        if (text.startsWith(ASK_MODE_PREFIX)) {
          text = text.slice(ASK_MODE_PREFIX.length)
        }
        result.push({
          id: nextParseId(),
          role: 'user',
          content: text,
          toolCalls: [],
        })
      }
    } else if (msg.type === 'injected_context') {
      const ic = (msg as { injectedContext?: InjectedContext }).injectedContext
      if (ic) {
        const lastUserIdx = result.findLastIndex(m => m.role === 'user')
        if (lastUserIdx >= 0) {
          result[lastUserIdx] = { ...result[lastUserIdx], injectedContext: ic }
        }
      }
    } else if (msg.type === 'assistant') {
      const textParts: string[] = []
      const thinkingParts: string[] = []
      const toolCalls: ToolCallInfo[] = []

      for (const block of content) {
        if (block.type === 'thinking' && block.thinking) {
          thinkingParts.push(block.thinking)
        } else if (block.type === 'text' && block.text) {
          textParts.push(block.text)
        } else if (block.type === 'tool_use' && block.id && block.name) {
          const toolResult = toolResults.get(block.id)
          toolCalls.push({
            id: block.id,
            name: block.name,
            input: block.input || {},
            result: toolResult?.content,
            isError: toolResult?.isError,
            status: toolResult ? (toolResult.isError ? 'error' : 'done') : 'running',
          })
        }
      }

      const text = textParts.join('\n')
      const thinking = thinkingParts.join('\n') || undefined
      if (text || toolCalls.length > 0 || thinking) {
        // Merge tool-only assistant messages into the previous assistant
        // message. Tool call chains produce many assistant→user→assistant
        // cycles in the raw data but should display as one message bubble.
        const last = result[result.length - 1]
        if (!text && toolCalls.length > 0 && last?.role === 'assistant') {
          last.toolCalls.push(...toolCalls)
          if (!last.thinking && thinking) last.thinking = thinking
        } else {
          result.push({
            id: nextParseId(),
            role: 'assistant',
            content: text,
            toolCalls,
            thinking,
          })
        }
      }
    }
  }

  return result
}

/**
 * Extract token usage from the last assistant message in raw session data.
 * The raw JSONL messages include `message.usage` with input_tokens, cache counts, etc.
 */
export function extractTokenUsageFromRaw(raw: RawSessionMessage[]): TokenUsage | null {
  // Sum subagent token usage across all subagent assistant messages
  let subagentInput = 0, subagentOutput = 0
  for (const msg of raw) {
    if (!msg.parent_tool_use_id || msg.type !== 'assistant') continue
    const usage = (msg.message as Record<string, unknown> | undefined)?.usage as Record<string, number> | undefined
    if (usage?.input_tokens) {
      subagentInput += usage.input_tokens
      subagentOutput += usage.output_tokens || 0
    }
  }

  // Walk backwards to find the last parent assistant message with usage
  for (let i = raw.length - 1; i >= 0; i--) {
    const msg = raw[i]
    if (msg.parent_tool_use_id) continue
    if (msg.type !== 'assistant') continue
    const message = msg.message as Record<string, unknown> | undefined
    if (!message) continue
    const usage = message.usage as Record<string, number> | undefined
    if (!usage || !usage.input_tokens) continue
    return {
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
      cacheReadInputTokens: usage.cache_read_input_tokens || 0,
      cacheCreationInputTokens: usage.cache_creation_input_tokens || 0,
      contextWindow: 200000,
      subagentInputTokens: subagentInput || undefined,
      subagentOutputTokens: subagentOutput || undefined,
    }
  }
  return null
}

/**
 * Extract the model ID from the last assistant message in raw session data.
 */
export function extractModelFromRaw(raw: RawSessionMessage[]): string | null {
  for (let i = raw.length - 1; i >= 0; i--) {
    const msg = raw[i]
    if (msg.type !== 'assistant') continue
    const message = msg.message as Record<string, unknown> | undefined
    if (!message) continue
    const model = message.model as string | undefined
    if (model) return model
  }
  return null
}

function extractContentBlocks(message: unknown): ContentBlock[] {
  if (!message || typeof message !== 'object') return []
  const msg = message as Record<string, unknown>

  // message.content can be a string or array of content blocks
  if (typeof msg.content === 'string') {
    return [{ type: 'text', text: msg.content }]
  }
  if (Array.isArray(msg.content)) {
    return msg.content as ContentBlock[]
  }
  return []
}
