import type { AgentProviderId } from '../../shared/provider-types'

export interface DiscoveredSession {
  sessionId: string
  provider: AgentProviderId
  title?: string | null
  firstPrompt?: string | null
  workspaceDir?: string | null
  updatedAt?: number | null
}

export interface ProviderStatusInfo {
  installed: boolean
  loggedIn: boolean
  detail?: string
  email?: string
  org?: string
}

/**
 * Per-provider session discovery, status, and message loading.
 * Each provider implements this to keep sessions.ts provider-agnostic.
 */
export interface ProviderSessionDiscovery {
  readonly providerId: AgentProviderId

  /** Discover sessions from this provider's external storage (SDK, DB, etc). */
  discoverSessions(context: DiscoveryContext): Promise<DiscoveredSession[]>

  /** Load messages for a session from the provider's external source. Returns null if unavailable. */
  getSessionMessages(sessionId: string, dir?: string): Promise<unknown[] | null>

  /** Get account info for this provider. */
  getAccountInfo(): Promise<unknown | null>

  /** Check installation + auth status. */
  checkStatus(): Promise<ProviderStatusInfo>

  /** Lightweight change detection for the session watcher (e.g. mtime check). */
  checkForChanges(): Promise<boolean>
}

export interface DiscoveryContext {
  relayClient?: { getApiBaseUrl: () => string | null; getAuthToken: () => string }
  getAuthToken?: () => Promise<string>
}
