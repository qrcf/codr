/// <reference types="vite/client" />

interface SessionInfo {
  sessionId: string
  summary: string
  lastModified: number
  fileSize: number
  customTitle?: string
  firstPrompt?: string
  gitBranch?: string
  cwd?: string
}

interface AccountInfo {
  email?: string
  organization?: string
  subscriptionType?: string
  tokenSource?: string
  apiKeySource?: string
}

interface RawSessionMessage {
  type: 'user' | 'assistant'
  uuid: string
  session_id: string
  message: unknown
  parent_tool_use_id: null
}

interface PermissionRequest {
  id: number
  tool: string
  input: unknown
}

interface ClaudeAPI {
  query: (prompt: string, options?: { resumeSessionId?: string }) => Promise<void>
  interrupt: () => Promise<void>
  onMessage: (callback: (message: unknown) => void) => () => void
  onError: (callback: (error: string) => void) => () => void
  onDone: (callback: () => void) => () => void
  onPermissionRequest: (callback: (request: PermissionRequest) => void) => () => void
  respondPermission: (id: number, allowed: boolean) => void
  updateSettings: (settings: { autoApproveEdits?: boolean; bashWhitelist?: string[] }) => void
  selectFolder: () => Promise<string | null>
  listSessions: () => Promise<SessionInfo[]>
  getSessionMessages: (sessionId: string) => Promise<RawSessionMessage[]>
  getAccountInfo: () => Promise<AccountInfo | null>
  onSessionRefreshHint: (callback: () => void) => () => void
}

interface Window {
  claude: ClaudeAPI
}
