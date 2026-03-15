/// <reference types="vite/client" />

declare module 'react-syntax-highlighter/dist/esm/prism-light'
declare module 'react-syntax-highlighter/dist/esm/styles/prism'
declare module 'react-syntax-highlighter/dist/esm/languages/prism/*'

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_RELAY_URL?: string
  readonly VITE_WEB_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Protocol/API types — sourced from @codr-works/types plus local provider metadata
type SessionInfo = import('@codr-works/types').SessionInfo & {
  provider?: 'claude' | 'codex'
  model?: string
  thinkingBudget?: string
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
  subagentInputTokens?: number
  subagentOutputTokens?: number
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
  type: 'user' | 'assistant' | 'injected_context' | 'system'
  uuid: string
  session_id: string
  message: unknown
  parent_tool_use_id: string | null
}

type AttachmentMeta = import('../../shared/attachments').AttachmentMeta

interface ClaudeAPI {
  getPathForFile?: (file: File) => string
  readClipboardFilePaths?: () => Promise<string[]>
  storeAttachments?: (filePaths: string[]) => Promise<AttachmentMeta[]>
  storeAttachmentBuffer?: (buffer: Uint8Array, filename: string) => Promise<AttachmentMeta>
  query: (prompt: string, options?: { resumeSessionId?: string; planMode?: boolean; askMode?: boolean; cwd?: string; model?: string; thinkingBudget?: 'low' | 'medium' | 'high'; attachments?: AttachmentMeta[] }) => Promise<void>
  interrupt: (sessionId?: string) => Promise<void>
  getProvider?: () => Promise<'claude' | 'codex'>
  setProvider?: (provider: 'claude' | 'codex') => Promise<{ provider?: 'claude' | 'codex'; error?: string }>
  getModels?: (provider?: 'claude' | 'codex') => Promise<{
    models: Array<{ value: string; displayName: string }>
    selectedModel?: string
  }>
  setModel?: (provider: 'claude' | 'codex', model: string | undefined) => Promise<{ model?: string }>
  getDefaults?: () => Promise<{ effortLevel?: string }>
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
  onSessionIdentified?: (callback: (data: { oldKey: string; newKey: string }) => void) => () => void
  onDraftTitleGenerated?: (callback: (data: { title: string }, querySessionId?: string | null) => void) => () => void
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
  regenTitle?: (sessionId: string, firstPrompt: string) => Promise<void>
  getRepoName?: (folderPath: string) => Promise<string>
  readClaudeMd?: (folderPath: string) => Promise<{ content?: string | null; error?: string }>
  writeClaudeMd?: (folderPath: string, content: string) => Promise<{ ok?: boolean; error?: string }>
  readPlanFile?: (filePath: string) => Promise<{ content?: string; error?: string }>
  onAccountInfoUpdate?: (callback: (info: AccountInfo) => void) => () => void
  onSessionRefreshHint: (callback: () => void) => () => void
  onSessionUpdated?: (callback: (data: { sessionId: string }) => void) => () => void

  // Remote access (desktop only)
  connectRemote?: () => Promise<void>
  disconnectRemote?: () => Promise<void>
  getRemoteStatus?: () => Promise<RemoteStatus | null>
  onRemoteStatusChange?: (callback: (status: RemoteStatus) => void) => () => void

  // Auth (desktop only)
  getAuthToken?: () => Promise<string | null>
  signOut?: () => Promise<void>
  onTokenStored?: (callback: () => void) => () => void
  onAuthUnauthorized?: (callback: () => void) => () => void
  openAuthInBrowser?: (webUrl: string) => Promise<void>

  // User profile (desktop only, from Clerk via API)
  getUserProfile?: () => Promise<{
    email: string | null
    firstName: string | null
    lastName: string | null
    fullName: string | null
    imageUrl: string | null
  } | null>

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
  onDocsSetupProgress?: (callback: (progress: { step: string; detail?: string; stepIndex: number; totalSteps: number }) => void) => () => void
  reinstallDocsRuntime?: () => Promise<{ ok?: boolean; error?: string }>
  fetchDocTitle?: (url: string) => Promise<{ title: string | null }>

  // Project Indexer
  indexerSearch?: (query: string, projectDir: string) => Promise<{path: string, score: number, text: string}[]>
  getIndexerStatus?: () => Promise<{status: string, detail?: string}>
  getIndexerProjectStatus?: (projectDir: string) => Promise<{status: string, fileCount?: number, detail?: string}>
  getIndexerProjectFiles?: (projectDir: string) => Promise<{path: string, chunkCount: number, language: string, size: number}[]>
  rebuildIndex?: (projectDir: string) => Promise<{ok: boolean}>
  updateIndex?: (projectDir: string) => Promise<{ok: boolean}>
  reinstallIndexer?: () => Promise<{ok: boolean}>
  onIndexerSetupProgress?: (cb: (progress: {step: string, detail?: string, projectDir?: string, progress?: {current: number, total: number}}) => void) => () => void

  // Wake recovery (desktop only)
  onWakeRecovery?: (callback: () => void) => () => void

  // Auto-updater (desktop only)
  installUpdate?: () => Promise<void>
  onUpdateStatus?: (cb: (status: UpdateStatus) => void) => () => void

}

interface UpdateStatus {
  status: 'downloaded' | 'error'
  version?: string
  error?: string
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
