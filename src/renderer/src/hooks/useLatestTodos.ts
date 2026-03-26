import { useMemo } from 'react'
import type { ChatMessage, ToolCallInfo } from '../types'

export interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm: string
}

/**
 * Derives the latest td list from messages and in-flight streaming tools.
 * Reverse-scans streaming tools first (most recent), then committed messages.
 * Returns null if no TodoWrite tool call exists in the conversation.
 */
export function useLatestTodos(
  messages: ChatMessage[],
  streamingTools: ToolCallInfo[],
): TodoItem[] | null {
  return useMemo(() => {
    // Check streaming tools first (in-flight, most recent)
    for (let i = streamingTools.length - 1; i >= 0; i--) {
      if (streamingTools[i].kind === 'TodoWrite') {
        const todos = streamingTools[i].input.todos as TodoItem[] | undefined
        if (todos && todos.length > 0) return todos
      }
    }
    // Check committed messages in reverse
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      for (let j = msg.toolCalls.length - 1; j >= 0; j--) {
        if (msg.toolCalls[j].kind === 'TodoWrite') {
          const todos = msg.toolCalls[j].input.todos as TodoItem[] | undefined
          if (todos && todos.length > 0) return todos
        }
      }
    }
    return null
  }, [messages, streamingTools])
}
