import type { ChatMessage, ToolCallInfo } from '../types'

export function reconcileParsedMessages(
  previous: ChatMessage[],
  next: ChatMessage[],
): ChatMessage[] {
  return next.map((nextMessage, index) => {
    const previousMessage = previous[index]
    if (previousMessage && messagesMatch(previousMessage, nextMessage)) {
      return previousMessage
    }
    if (nextMessage.role === 'user' && previousMessage?.injectedContext && !nextMessage.injectedContext) {
      return { ...nextMessage, injectedContext: previousMessage.injectedContext }
    }
    return nextMessage
  })
}

function messagesMatch(a: ChatMessage, b: ChatMessage): boolean {
  return a.role === b.role
    && a.content === b.content
    && a.thinking === b.thinking
    && toolCallsMatch(a.toolCalls, b.toolCalls)
    && attachmentsMatch(a.attachments, b.attachments)
}

function toolCallsMatch(a: ToolCallInfo[], b: ToolCallInfo[]): boolean {
  if (a.length !== b.length) return false
  return a.every((tool, index) => {
    const other = b[index]
    if (!other) return false
    return tool.id === other.id
      && tool.kind === other.kind
      && tool.result === other.result
      && tool.isError === other.isError
      && tool.status === other.status
      && JSON.stringify(tool.input) === JSON.stringify(other.input)
  })
}

function attachmentsMatch(a?: ChatMessage['attachments'], b?: ChatMessage['attachments']): boolean {
  if (!a && !b) return true
  if (!a || !b || a.length !== b.length) return false
  return a.every((attachment, index) => JSON.stringify(attachment) === JSON.stringify(b[index]))
}
