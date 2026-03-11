import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('claude', {
  query: (prompt: string, opts?: { resumeSessionId?: string }) =>
    ipcRenderer.invoke('agent:query', prompt, opts),
  interrupt: () => ipcRenderer.invoke('agent:interrupt'),

  onMessage: (callback: (message: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: unknown) => callback(message)
    ipcRenderer.on('agent:message', listener)
    return () => { ipcRenderer.removeListener('agent:message', listener) }
  },

  onError: (callback: (error: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, error: string) => callback(error)
    ipcRenderer.on('agent:error', listener)
    return () => { ipcRenderer.removeListener('agent:error', listener) }
  },

  onDone: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('agent:done', listener)
    return () => { ipcRenderer.removeListener('agent:done', listener) }
  },

  onPermissionRequest: (callback: (request: { id: number; tool: string; input: unknown }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, request: { id: number; tool: string; input: unknown }) => callback(request)
    ipcRenderer.on('agent:permission-request', listener)
    return () => { ipcRenderer.removeListener('agent:permission-request', listener) }
  },

  respondPermission: (id: number, allowed: boolean) => {
    ipcRenderer.send('agent:permission-response', { id, allowed })
  },

  updateSettings: (settings: { autoApproveEdits?: boolean; bashWhitelist?: string[] }) => {
    ipcRenderer.send('agent:settings-update', settings)
  },

  // Session management
  selectFolder: () => ipcRenderer.invoke('sessions:select-folder'),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  getSessionMessages: (sessionId: string) => ipcRenderer.invoke('sessions:get-messages', sessionId),
  getAccountInfo: () => ipcRenderer.invoke('sessions:get-account-info'),
  listFiles: (dir?: string) => ipcRenderer.invoke('sessions:list-files', dir),

  onSessionRefreshHint: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('sessions:refresh-hint', listener)
    return () => { ipcRenderer.removeListener('sessions:refresh-hint', listener) }
  },

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
})
