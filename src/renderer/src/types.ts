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
    delta?: { type: string; text?: string; thinking?: string }
    content_block?: ContentBlock
  }
}

export interface ToolUseSummaryMessage {
  type: 'tool_use_summary'
  summary: string
  preceding_tool_use_ids: string[]
}

export interface ResultMessage {
  type: 'result'
  subtype: string
  result?: string
}

export type AgentMessage = AssistantMessage | StreamEvent | ToolUseSummaryMessage | ResultMessage | { type: string; [key: string]: unknown }

export interface InjectedContext {
  mode?: 'ask' | 'plan' | 'code'
  systemPrompt?: { preset: string; append?: string }
  developerInstructions?: string
  context?: {
    codebase?: { source: string; score?: number }[]
    documentation?: { source: string; url?: string; heading?: string }[]
    files?: { source: string }[]
  }
}

// Chat display types
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  toolCalls: ToolCallInfo[]
  thinking?: string
  attachments?: AttachmentMeta[]
  injectedContext?: InjectedContext
}

export interface ToolCallInfo {
  id: string
  name: string
  input: Record<string, unknown>
  result?: string
  isError?: boolean
  status: 'running' | 'done' | 'error'
}

export interface PlanReviewState {
  planFilePath: string
  planContent: string
  allowedPrompts?: Array<{ tool: string; prompt: string }>
  provider?: AgentProviderId
  sourceSessionId?: string
  nativePlanToken?: string
}
