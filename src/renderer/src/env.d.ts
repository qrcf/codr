/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLERK_PUBLISHABLE_KEY: string
  readonly VITE_RELAY_URL?: string
  readonly VITE_WEB_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Protocol/API types — sourced from @codr-works/types plus local provider metadata
type SessionInfo = import('@codr-works/types').SessionInfo & {
  provider?: 'claude' | 'codex'
}
type AccountInfo = import('@codr-works/types').AccountInfo
type PermissionRequest = import('@codr-works/types').PermissionRequest
type QuestionOption = import('@codr-works/types').QuestionOption
type QuestionItem = import('@codr-works/types').QuestionItem
type QuestionRequest = import('@codr-works/types').QuestionRequest
type RemoteStatus = import('@codr-works/types').RemoteStatus
type DocSource = import('@codr-works/types').DocSource
type DocCrawlProgress = import('@codr-works/types').DocCrawlProgress

// Client-only types

interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  contextWindow: number
}

interface ConversationStatePayload {
  messages: import('./types').ChatMessage[]
  isLoading: boolean
  isCompacting?: boolean
  streamingText: string
  streamingThinking: string
  streamingTools: import('./types').ToolCallInfo[]
  permissionRequest: PermissionRequest | null
  questionRequest: QuestionRequest | null
  planReview: import('./types').PlanReviewState | null
  querySessionId: string | null
  tokenUsage: TokenUsage | null
}

interface StateSyncPayload {
  // Multi-session: all active query states keyed by session ID
  activeStates?: Record<string, ConversationStatePayload>
  // Legacy single-session fields
  messages?: import('./types').ChatMessage[]
  isLoading?: boolean
  streamingText?: string
  streamingThinking?: string
  streamingTools?: import('./types').ToolCallInfo[]
  permissionRequest?: PermissionRequest | null
  questionRequest?: QuestionRequest | null
  planReview?: import('./types').PlanReviewState | null
  querySessionId?: string | null
}

interface RawSessionMessage {
  type: 'user' | 'assistant'
  uuid: string
  session_id: string
  message: unknown
  parent_tool_use_id: null
}

interface ClaudeAPI {
  query: (prompt: string, options?: { resumeSessionId?: string; planMode?: boolean; askMode?: boolean; cwd?: string }) => Promise<void>
  interrupt: (sessionId?: string) => Promise<void>
  getProvider?: () => Promise<'claude' | 'codex'>
  setProvider?: (provider: 'claude' | 'codex') => Promise<{ provider?: 'claude' | 'codex'; error?: string }>
  getAgentState?: (sessionId?: string) => Promise<{
    isLoading: boolean
    streamingText: string
    streamingThinking: string
    streamingTools: import('./types').ToolCallInfo[]
    permissionRequest?: PermissionRequest | null
    questionRequest?: QuestionRequest | null
    planReview?: import('./types').PlanReviewState | null
    querySessionId?: string | null
  }>
  onMessage: (callback: (message: unknown, querySessionId?: string | null) => void) => () => void
  onError: (callback: (error: string, querySessionId?: string | null) => void) => () => void
  onDone: (callback: (querySessionId?: string | null) => void) => () => void
  onPermissionRequest: (callback: (request: PermissionRequest, querySessionId?: string | null) => void) => () => void
  respondPermission: (id: number, allowed: boolean, opts?: { alwaysAllow?: boolean; toolName?: string; message?: string }) => void
  onPermissionCleared?: (callback: (data: { id: number }, querySessionId?: string | null) => void) => () => void
  onQuestionRequest?: (callback: (request: QuestionRequest, querySessionId?: string | null) => void) => () => void
  respondQuestion?: (id: number, answers: Record<string, string>) => void
  onQuestionCleared?: (callback: (data: { id: number }, querySessionId?: string | null) => void) => () => void
  updateSettings: (settings: { autoApproveEdits?: boolean; bashWhitelist?: string[] }) => void
  selectFolder: () => Promise<string | null>
  listSessions: () => Promise<{ sessions: SessionInfo[]; titlesLoaded: boolean }>
  getSessionMessages: (sessionId: string) => Promise<RawSessionMessage[]>
  getAccountInfo: () => Promise<AccountInfo | null>
  listFiles: (dir?: string) => Promise<string[]>
  ensureTitle?: (sessionId: string, firstPrompt?: string) => Promise<void>
  getRepoName?: (folderPath: string) => Promise<string>
  readClaudeMd?: (folderPath: string) => Promise<{ content?: string | null; error?: string }>
  writeClaudeMd?: (folderPath: string, content: string) => Promise<{ ok?: boolean; error?: string }>
  readPlanFile?: (filePath: string) => Promise<{ content?: string; error?: string }>
  onAccountInfoUpdate?: (callback: (info: AccountInfo) => void) => () => void
  onSessionRefreshHint: (callback: () => void) => () => void
  onSessionUpdated?: (callback: (data: { sessionId: string }) => void) => () => void

  // Remote access (desktop only)
  connectRemote?: (relayUrl: string, clerkToken: string) => Promise<void>
  disconnectRemote?: () => Promise<void>
  getRemoteStatus?: () => Promise<RemoteStatus | null>
  onRemoteStatusChange?: (callback: (status: RemoteStatus) => void) => () => void

  // Auth via system browser (desktop only)
  onAuthToken?: (callback: (token: string) => void) => () => void
  openAuthInBrowser?: (webUrl: string) => Promise<void>

  // State sync (web only)
  onStateSync?: (callback: (state: StateSyncPayload) => void) => () => void
  onDesktopStatus?: (callback: (online: boolean) => void) => () => void

  // CLI status check (desktop only)
  checkCliStatus?: () => Promise<CliStatus>

  // Provider status — independent check for both Claude and Codex (desktop only)
  getProviderStatus?: () => Promise<{
    claude: { installed: boolean; loggedIn: boolean; detail?: string }
    codex: { installed: boolean; loggedIn: boolean; detail?: string }
  }>

  // Docs feature
  addDocSource?: (source: { url: string; name: string; crawlDepth?: number; prefix?: string }) => Promise<DocSource | { error: string }>
  removeDocSource?: (sourceId: number) => Promise<{ ok?: boolean; error?: string }>
  recrawlDocSource?: (sourceId: number, url: string, crawlDepth: number, prefix?: string) => Promise<{ ok?: boolean; error?: string }>
  cancelDocCrawl?: (sourceId: number) => Promise<{ ok?: boolean; error?: string }>
  onDocsCrawlProgress?: (callback: (progress: DocCrawlProgress) => void) => () => void
}

type CliStatus =
  | { status: 'ready'; accountInfo: AccountInfo }
  | { status: 'not-installed' }
  | { status: 'not-logged-in' }
  | { status: 'error'; message: string }
  | { status: 'checking' }

interface Window {
  claude: ClaudeAPI
  agent?: ClaudeAPI
}
