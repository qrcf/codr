import type { ChatMessage, ToolCallInfo } from '../types'

let parseIdCounter = 0
function nextParseId() {
  return `parsed-${++parseIdCounter}`
}

interface ContentBlock {
  type: string
  text?: string
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

  for (const msg of raw) {
    const content = extractContentBlocks(msg.message)

    if (msg.type === 'user') {
      // Extract text from user messages, skip tool_result blocks
      const textParts: string[] = []
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          textParts.push(block.text)
        }
      }
      const text = textParts.join('\n')
      if (text) {
        result.push({
          id: nextParseId(),
          role: 'user',
          content: text,
          toolCalls: [],
        })
      }
    } else if (msg.type === 'assistant') {
      const textParts: string[] = []
      const toolCalls: ToolCallInfo[] = []

      for (const block of content) {
        if (block.type === 'text' && block.text) {
          textParts.push(block.text)
        } else if (block.type === 'tool_use' && block.id && block.name) {
          const toolResult = toolResults.get(block.id)
          toolCalls.push({
            id: block.id,
            name: block.name,
            input: block.input || {},
            result: toolResult?.content,
            isError: toolResult?.isError,
            status: toolResult ? (toolResult.isError ? 'error' : 'done') : 'done',
          })
        }
      }

      const text = textParts.join('\n')
      if (text || toolCalls.length > 0) {
        result.push({
          id: nextParseId(),
          role: 'assistant',
          content: text,
          toolCalls,
        })
      }
    }
  }

  return result
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
