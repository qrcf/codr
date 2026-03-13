import type { RelayClient } from '../relay-client'
import type { EventBroadcaster } from '../event-broadcaster'
import type { MessageOrigin } from '../permissions'

export type AgentProviderId = 'claude' | 'codex'

export interface AgentQueryRequest {
  prompt: string
  resumeSessionId?: string
  planMode?: boolean
  cwd?: string
  askMode?: boolean
  origin?: MessageOrigin
}

export interface ProviderRunCallbacks {
  onSessionIdentified: (sessionId: string) => void
  onMessage: (message: unknown, querySessionId: string) => void
  onError: (errorText: string, querySessionId: string) => void
  onDone: (querySessionId: string) => void
  onAccountInfo?: (info: unknown) => void
}

export interface ProviderRunResult {
  queryKey: string
}

export interface ProviderSessionStore {
  upsertSessionMetadata: (sessionId: string, data: {
    provider: AgentProviderId
    firstPrompt?: string | null
    title?: string | null
    workspaceDir?: string | null
    providerSessionId?: string | null
  }) => Promise<void>
  putRawMessages: (sessionId: string, provider: AgentProviderId, rawMessages: unknown[]) => Promise<void>
  appendRawMessage: (sessionId: string, provider: AgentProviderId, rawMessage: unknown) => Promise<void>
}

export interface AgentProviderContext {
  broadcaster: EventBroadcaster
  relayClient: RelayClient
  sessionStore: ProviderSessionStore
}

export interface AgentProvider {
  readonly id: AgentProviderId
  runQuery: (req: AgentQueryRequest, callbacks: ProviderRunCallbacks) => Promise<ProviderRunResult>
  interruptQuery: (sessionId?: string) => Promise<void>
}
