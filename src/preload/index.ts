import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AttachmentMeta } from '../shared/attachments'
import type { AgentProviderId } from '../shared/provider-types'

const agentApi = {
  isElectron: true,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  readClipboardFilePaths: () => ipcRenderer.invoke('clipboard:read-file-paths') as Promise<string[]>,

  // File attachments
  storeAttachments: (filePaths: string[]) =>
    ipcRenderer.invoke('attachments:store', filePaths) as Promise<AttachmentMeta[]>,
  storeAttachmentBuffer: (buffer: Uint8Array, filename: string) =>
    ipcRenderer.invoke('attachments:store-buffer', buffer, filename) as Promise<AttachmentMeta>,

  query: (prompt: string, opts?: { resumeSessionId?: string; planMode?: boolean; askMode?: boolean; model?: string; thinkingBudget?: 'low' | 'medium' | 'high'; attachments?: AttachmentMeta[] }) =>
    ipcRenderer.invoke('agent:query', prompt, opts),
  interrupt: (sessionId?: string) => ipcRenderer.invoke('agent:interrupt', sessionId),
  getAgentState: (sessionId?: string) => ipcRenderer.invoke('agent:get-state', sessionId),
  getProvider: () => ipcRenderer.invoke('agent:get-provider') as Promise<AgentProviderId>,
  setProvider: (provider: AgentProviderId) => ipcRenderer.invoke('agent:set-provider', provider) as Promise<{ provider?: AgentProviderId; error?: string }>,
  getModels: (provider?: AgentProviderId) =>
    ipcRenderer.invoke('agent:get-models', provider) as Promise<{ models: Array<{ value: string; displayName: string }>; selectedModel?: string }>,
  setModel: (provider: AgentProviderId, model: string | undefined) =>
    ipcRenderer.invoke('agent:set-model', provider, model) as Promise<{ model?: string }>,
  getDefaults: () =>
    ipcRenderer.invoke('agent:get-defaults') as Promise<{ effortLevel?: string }>,

  onMessage: (callback: (message: unknown, querySessionId?: string | null) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: unknown, qsid?: string | null) => callback(message, qsid ?? null)
    ipcRenderer.on('agent:message', listener)
    return () => { ipcRenderer.removeListener('agent:message', listener) }
  },

  onError: (callback: (error: string, querySessionId?: string | null) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, error: string, qsid?: string | null) => callback(error, qsid ?? null)
    ipcRenderer.on('agent:error', listener)
    return () => { ipcRenderer.removeListener('agent:error', listener) }
  },

  onDone: (callback: (querySessionId?: string | null) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, _data: unknown, qsid?: string | null) => callback(qsid ?? null)
    ipcRenderer.on('agent:done', listener)
    return () => { ipcRenderer.removeListener('agent:done', listener) }
  },

  onSessionIdentified: (callback: (data: { oldKey: string; newKey: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { oldKey: string; newKey: string }) => callback(data)
    ipcRenderer.on('agent:session-identified', listener)
    return () => { ipcRenderer.removeListener('agent:session-identified', listener) }
  },

  onDraftTitleGenerated: (callback: (data: { title: string }, querySessionId?: string | null) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { title: string }, qsid?: string | null) => callback(data, qsid ?? null)
    ipcRenderer.on('agent:draft-title-generated', listener)
    return () => { ipcRenderer.removeListener('agent:draft-title-generated', listener) }
  },

  onPermissionRequest: (callback: (request: { id: number; tool: string; input: unknown }, querySessionId?: string | null) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, request: { id: number; tool: string; input: unknown }, qsid?: string | null) => callback(request, qsid ?? null)
    ipcRenderer.on('agent:permission-request', listener)
    return () => { ipcRenderer.removeListener('agent:permission-request', listener) }
  },

  respondPermission: (id: number, allowed: boolean, opts?: { alwaysAllow?: boolean; toolName?: string; message?: string }) => {
    ipcRenderer.send('agent:permission-response', { id, allowed, ...opts })
  },

  onPermissionCleared: (callback: (data: { id: number }, querySessionId?: string | null) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { id: number }, qsid?: string | null) => callback(data, qsid ?? null)
    ipcRenderer.on('agent:permission-cleared', listener)
    return () => { ipcRenderer.removeListener('agent:permission-cleared', listener) }
  },

  onQuestionRequest: (callback: (request: { id: number; questions: unknown[] }, querySessionId?: string | null) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, request: { id: number; questions: unknown[] }, qsid?: string | null) => callback(request, qsid ?? null)
    ipcRenderer.on('agent:question-request', listener)
    return () => { ipcRenderer.removeListener('agent:question-request', listener) }
  },

  respondQuestion: (id: number, answers: Record<string, string>) => {
    ipcRenderer.send('agent:question-response', { id, answers })
  },

  onQuestionCleared: (callback: (data: { id: number }, querySessionId?: string | null) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { id: number }, qsid?: string | null) => callback(data, qsid ?? null)
    ipcRenderer.on('agent:question-cleared', listener)
    return () => { ipcRenderer.removeListener('agent:question-cleared', listener) }
  },

  updateSettings: (settings: { autoApproveEdits?: boolean; bashWhitelist?: string[] }) => {
    ipcRenderer.send('agent:settings-update', settings)
  },

  // Session management
  selectFolder: () => ipcRenderer.invoke('sessions:select-folder'),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  getSessionMessages: (sessionId: string) => ipcRenderer.invoke('sessions:get-messages', sessionId),
  getAccountInfo: () => {
    // Try the probe query first (works in dev). If it fails, keep the promise
    // pending until agent.ts pushes account info via IPC after the first real query.
    return new Promise((resolve) => {
      const listener = (_event: Electron.IpcRendererEvent, info: unknown) => {
        ipcRenderer.removeListener('sessions:account-info-update', listener)
        resolve(info)
      }
      ipcRenderer.on('sessions:account-info-update', listener)

      ipcRenderer.invoke('sessions:get-account-info').then((result) => {
        if (result && typeof result === 'object' && !('error' in result)) {
          ipcRenderer.removeListener('sessions:account-info-update', listener)
          resolve(result)
        }
        // else: probe failed — promise stays pending until IPC event fires
      })
    })
  },
  listFiles: (dir?: string) => ipcRenderer.invoke('sessions:list-files', dir),
  regenTitle: (sessionId: string, firstPrompt: string) => ipcRenderer.invoke('sessions:regen-title', sessionId, firstPrompt),
  getRepoName: (folderPath: string) => ipcRenderer.invoke('sessions:get-repo-name', folderPath),

  onAccountInfoUpdate: (callback: (info: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, info: unknown) => callback(info)
    ipcRenderer.on('sessions:account-info-update', listener)
    return () => { ipcRenderer.removeListener('sessions:account-info-update', listener) }
  },

  onSessionRefreshHint: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('sessions:refresh-hint', listener)
    return () => { ipcRenderer.removeListener('sessions:refresh-hint', listener) }
  },

  onSessionUpdated: (callback: (data: { sessionId: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { sessionId: string }) => callback(data)
    ipcRenderer.on('sessions:session-updated', listener)
    return () => { ipcRenderer.removeListener('sessions:session-updated', listener) }
  },

  // Project CLAUDE.md
  readClaudeMd: (folderPath: string) =>
    ipcRenderer.invoke('project:read-claude-md', folderPath),
  writeClaudeMd: (folderPath: string, content: string) =>
    ipcRenderer.invoke('project:write-claude-md', folderPath, content),

  // Plan file reader
  readPlanFile: (filePath: string) =>
    ipcRenderer.invoke('plan:read-file', filePath),

  // Remote access
  connectRemote: () =>
    ipcRenderer.invoke('remote:connect'),
  disconnectRemote: () =>
    ipcRenderer.invoke('remote:disconnect'),
  getRemoteStatus: () =>
    ipcRenderer.invoke('remote:status'),
  onRemoteStatusChange: (callback: (status: { status: string; webClients: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: { status: string; webClients: number }) => callback(status)
    ipcRenderer.on('remote:status-change', listener)
    return () => { ipcRenderer.removeListener('remote:status-change', listener) }
  },

  // Auth
  getAuthToken: () => ipcRenderer.invoke('auth:get-token') as Promise<string | null>,
  signOut: () => ipcRenderer.invoke('auth:sign-out') as Promise<void>,
  onTokenStored: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('auth:token-stored', listener)
    return () => { ipcRenderer.removeListener('auth:token-stored', listener) }
  },
  onAuthUnauthorized: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('auth:unauthorized', listener)
    return () => { ipcRenderer.removeListener('auth:unauthorized', listener) }
  },
  openAuthInBrowser: (webUrl: string) =>
    ipcRenderer.invoke('auth:open-browser', webUrl),

  // User profile (fetched from API via Clerk)
  getUserProfile: () => ipcRenderer.invoke('user:get-profile') as Promise<{
    email: string | null
    firstName: string | null
    lastName: string | null
    fullName: string | null
    imageUrl: string | null
  } | null>,

  // CLI status check
  checkCliStatus: () => ipcRenderer.invoke('cli:check-status'),

  // Provider status (independent check for both Claude and Codex)
  getProviderStatus: () => ipcRenderer.invoke('providers:get-status') as Promise<{
    claude: { installed: boolean; loggedIn: boolean; detail?: string }
    codex: { installed: boolean; loggedIn: boolean; detail?: string }
  }>,

  // Docs feature
  addDocSource: (source: { url: string; name: string; crawlDepth?: number; prefix?: string }) =>
    ipcRenderer.invoke('docs:add-source', source),
  removeDocSource: (sourceId: number) =>
    ipcRenderer.invoke('docs:remove-source', sourceId),
  recrawlDocSource: (sourceId: number, url: string, crawlDepth: number, prefix?: string) =>
    ipcRenderer.invoke('docs:recrawl', sourceId, url, crawlDepth, prefix),
  cancelDocCrawl: (sourceId: number) =>
    ipcRenderer.invoke('docs:cancel-crawl', sourceId),
  onDocsCrawlProgress: (callback: (progress: { sourceId: number; status: string; pagesCrawled: number; currentUrl?: string; error?: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: { sourceId: number; status: string; pagesCrawled: number; currentUrl?: string; error?: string }) => callback(progress)
    ipcRenderer.on('docs:crawl-progress', listener)
    return () => { ipcRenderer.removeListener('docs:crawl-progress', listener) }
  },
  onDocsSetupProgress: (callback: (progress: { step: string; detail?: string; stepIndex: number; totalSteps: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: { step: string; detail?: string; stepIndex: number; totalSteps: number }) => callback(progress)
    ipcRenderer.on('docs:setup-progress', listener)
    return () => { ipcRenderer.removeListener('docs:setup-progress', listener) }
  },
  reinstallDocsRuntime: () =>
    ipcRenderer.invoke('docs:reinstall-runtime') as Promise<{ ok?: boolean; error?: string }>,
  fetchDocTitle: (url: string) =>
    ipcRenderer.invoke('docs:fetch-title', url) as Promise<{ title: string | null }>,

  // Project Indexer
  indexerSearch: (query: string, projectDir: string) =>
    ipcRenderer.invoke('indexer:search', query, projectDir) as Promise<{ path: string; score: number; text: string }[]>,
  getIndexerStatus: () =>
    ipcRenderer.invoke('indexer:status') as Promise<{ status: string; detail?: string }>,
  getIndexerProjectStatus: (projectDir: string) =>
    ipcRenderer.invoke('indexer:project-status', projectDir) as Promise<{ status: string; fileCount?: number; detail?: string }>,
  getIndexerProjectFiles: (projectDir: string) =>
    ipcRenderer.invoke('indexer:project-files', projectDir) as Promise<{ path: string; chunkCount: number; language: string; size: number }[]>,
  rebuildIndex: (projectDir: string) =>
    ipcRenderer.invoke('indexer:rebuild', projectDir) as Promise<{ ok: boolean }>,
  updateIndex: (projectDir: string) =>
    ipcRenderer.invoke('indexer:update', projectDir) as Promise<{ ok: boolean }>,
  reinstallIndexer: () =>
    ipcRenderer.invoke('indexer:reinstall') as Promise<{ ok: boolean }>,
  backgroundRefreshIndex: (projectDir: string) =>
    ipcRenderer.invoke('indexer:background-refresh', projectDir),
  onIndexerSetupProgress: (callback: (progress: { step: string; detail?: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: { step: string; detail?: string }) => callback(progress)
    ipcRenderer.on('indexer:setup-progress', listener)
    return () => { ipcRenderer.removeListener('indexer:setup-progress', listener) }
  },

  // Files config
  getGlobalFilesConfig: () =>
    ipcRenderer.invoke('files-config:get-global') as Promise<{ ignoreDirs: string[]; extraIgnoreFiles: string[] }>,
  setGlobalFilesConfig: (cfg: { ignoreDirs?: string[]; extraIgnoreFiles?: string[] }) =>
    ipcRenderer.invoke('files-config:set-global', cfg) as Promise<{ ok: boolean }>,
  getProjectFilesConfig: (projectDir: string) =>
    ipcRenderer.invoke('files-config:get-project', projectDir) as Promise<{ extraIgnoreDirs?: string[]; extraPatterns?: string[] }>,
  setProjectFilesConfig: (projectDir: string, cfg: { extraIgnoreDirs?: string[]; extraPatterns?: string[] }) =>
    ipcRenderer.invoke('files-config:set-project', projectDir, cfg) as Promise<{ ok: boolean }>,
  getComputedIgnores: (projectDir: string) =>
    ipcRenderer.invoke('files-config:get-computed', projectDir) as Promise<{ pattern: string; source: string }[]>,

  // Wake recovery (sleep/wake cleanup)
  onWakeRecovery: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('agent:wake-recovery', listener)
    return () => { ipcRenderer.removeListener('agent:wake-recovery', listener) }
  },

  // Auto-updater (desktop only)
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  onUpdateStatus: (callback: (status: { status: string; version?: string; error?: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: { status: string; version?: string; error?: string }) => callback(status)
    ipcRenderer.on('updater:status', listener)
    return () => { ipcRenderer.removeListener('updater:status', listener) }
  },

}

contextBridge.exposeInMainWorld('codr', agentApi)
