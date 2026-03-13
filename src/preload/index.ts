import { contextBridge, ipcRenderer } from 'electron'

const agentApi = {
  isElectron: true,

  query: (prompt: string, opts?: { resumeSessionId?: string; planMode?: boolean; askMode?: boolean }) =>
    ipcRenderer.invoke('agent:query', prompt, opts),
  interrupt: (sessionId?: string) => ipcRenderer.invoke('agent:interrupt', sessionId),
  getAgentState: (sessionId?: string) => ipcRenderer.invoke('agent:get-state', sessionId),
  getProvider: () => ipcRenderer.invoke('agent:get-provider') as Promise<'claude' | 'codex'>,
  setProvider: (provider: 'claude' | 'codex') => ipcRenderer.invoke('agent:set-provider', provider) as Promise<{ provider?: 'claude' | 'codex'; error?: string }>,

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
  ensureTitle: (sessionId: string, firstPrompt?: string) => ipcRenderer.invoke('sessions:ensure-title', sessionId, firstPrompt),
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
  connectRemote: (relayUrl: string, clerkToken: string) =>
    ipcRenderer.invoke('remote:connect', relayUrl, clerkToken),
  disconnectRemote: () =>
    ipcRenderer.invoke('remote:disconnect'),
  getRemoteStatus: () =>
    ipcRenderer.invoke('remote:status'),
  onRemoteStatusChange: (callback: (status: { status: string; webClients: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: { status: string; webClients: number }) => callback(status)
    ipcRenderer.on('remote:status-change', listener)
    return () => { ipcRenderer.removeListener('remote:status-change', listener) }
  },

  // Auth via system browser (deep link OAuth)
  onAuthToken: (callback: (token: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, token: string) => callback(token)
    ipcRenderer.on('auth:sign-in-token', listener)
    return () => { ipcRenderer.removeListener('auth:sign-in-token', listener) }
  },
  openAuthInBrowser: (webUrl: string) =>
    ipcRenderer.invoke('auth:open-browser', webUrl),

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
}

contextBridge.exposeInMainWorld('claude', agentApi)
contextBridge.exposeInMainWorld('agent', agentApi)
