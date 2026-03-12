// Shared types used by main process modules.
// Mirrors the renderer types without importing from renderer source.

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
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

export interface PlanReviewState {
  planFilePath: string
  planContent: string
  allowedPrompts?: Array<{ tool: string; prompt: string }>
}
