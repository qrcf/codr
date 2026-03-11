// Renderer-side message types — mirrors relevant SDK message shapes
// without importing the Node-only SDK package.

export interface ToolUseContent {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface TextContent {
  type: 'text'
  text: string
}

export type ContentBlock = ToolUseContent | TextContent | { type: string; [key: string]: unknown }

export interface AssistantMessage {
  type: 'assistant'
  message: {
    content: ContentBlock[]
  }
}

export interface StreamEvent {
  type: 'stream_event'
  event: {
    type: string
    index?: number
    delta?: { type: string; text?: string }
    content_block?: ContentBlock
  }
}

export interface ToolUseSummaryMessage {
  type: 'tool_use_summary'
  tool_name: string
  tool_input: Record<string, unknown>
  tool_result?: string
  is_error?: boolean
}

export interface ResultMessage {
  type: 'result'
  subtype: string
  result?: string
}

export type AgentMessage = AssistantMessage | StreamEvent | ToolUseSummaryMessage | ResultMessage | { type: string; [key: string]: unknown }

// Chat display types
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls: ToolCallInfo[]
}

export interface ToolCallInfo {
  id: string
  name: string
  input: Record<string, unknown>
  result?: string
  isError?: boolean
  status: 'running' | 'done' | 'error'
}
