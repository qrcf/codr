// Shared types used by main process modules.
// Mirrors the renderer types without importing from renderer source.
import type { AgentProviderId } from '../shared/provider-types'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  toolCalls: ToolCallInfo[]
  thinking?: string
}

export interface ToolCallInfo {
  id: string
  kind: string
  title?: string
  input: Record<string, unknown>
  result?: string
  isError?: boolean
  status: 'running' | 'done' | 'error'
  content?: Array<{ type: string; [key: string]: unknown }>
  locations?: Array<{ path: string; line?: number | null }>
  rawInput?: unknown
  rawOutput?: unknown
  meta?: Record<string, unknown>
}

export interface PlanReviewState {
  planFilePath: string
  planContent: string
  allowedPrompts?: Array<{ tool: string; prompt: string }>
  provider?: AgentProviderId
  sourceSessionId?: string
  nativePlanToken?: string
}
