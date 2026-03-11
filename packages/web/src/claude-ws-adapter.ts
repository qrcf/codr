type Callback<T = void> = T extends void ? () => void : (data: T) => void

interface PendingRequest {
  resolve: (data: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface StateSyncPayload {
  messages: unknown[]
  isLoading: boolean
  streamingText: string
  streamingTools: unknown[]
  permissionRequest: { id: number; tool: string; input: unknown } | null
}

export function createWebSocketClaudeAPI(relayUrl: string, getToken: () => Promise<string>) {
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectDelay = 1000
  let shouldReconnect = true

  const messageCallbacks: Array<(msg: unknown) => void> = []
  const errorCallbacks: Array<(error: string) => void> = []
  const doneCallbacks: Array<() => void> = []
  const permissionCallbacks: Array<(req: { id: number; tool: string; input: unknown }) => void> = []
  const sessionRefreshCallbacks: Array<() => void> = []
  const stateSyncCallbacks: Array<(state: StateSyncPayload) => void> = []
  const desktopStatusCallbacks: Array<(online: boolean) => void> = []
  const pendingRequests = new Map<string, PendingRequest>()

  function subscribe<T>(arr: Array<Callback<T>>, cb: Callback<T>): () => void {
    arr.push(cb)
    return () => {
      const idx = arr.indexOf(cb)
      if (idx >= 0) arr.splice(idx, 1)
    }
  }

  function sendJson(data: unknown) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data))
    }
  }

  function generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  function request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const requestId = generateRequestId()
      const timer = setTimeout(() => {
        pendingRequests.delete(requestId)
        reject(new Error(`Request ${method} timed out`))
      }, 30_000)

      pendingRequests.set(requestId, { resolve, reject, timer })
      sendJson({ type: 'request', requestId, method, params })
    })
  }

  function handleMessage(data: { type: string; [key: string]: unknown }) {
    switch (data.type) {
      case 'agent_message':
        for (const cb of messageCallbacks) cb(data.message)
        break
      case 'agent_error':
        for (const cb of errorCallbacks) cb(data.error as string)
        break
      case 'agent_done':
        for (const cb of doneCallbacks) cb()
        break
      case 'permission_request':
        for (const cb of permissionCallbacks) {
          cb({ id: data.id as number, tool: data.tool as string, input: data.input })
        }
        break
      case 'sessions_refresh_hint':
        for (const cb of sessionRefreshCallbacks) cb()
        break
      case 'state_sync':
        for (const cb of stateSyncCallbacks) {
          cb(data as unknown as StateSyncPayload)
        }
        break
      case 'desktop_status':
        for (const cb of desktopStatusCallbacks) cb(data.online as boolean)
        break
      case 'auth_result':
        if (data.desktopOnline !== undefined) {
          for (const cb of desktopStatusCallbacks) cb(data.desktopOnline as boolean)
        }
        break
      case 'response': {
        const pending = pendingRequests.get(data.requestId as string)
        if (pending) {
          clearTimeout(pending.timer)
          pendingRequests.delete(data.requestId as string)
          pending.resolve(data.data)
        }
        break
      }
      case 'error':
        console.error('[relay]', data.error)
        break
    }
  }

  async function connect() {
    if (ws) {
      ws.close()
      ws = null
    }

    const token = await getToken()

    ws = new WebSocket(relayUrl)

    ws.onopen = () => {
      sendJson({ type: 'auth', token, role: 'web' })
      reconnectDelay = 1000
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string)
        handleMessage(data)
      } catch {
        // ignore parse errors
      }
    }

    ws.onclose = () => {
      if (shouldReconnect) {
        scheduleReconnect()
      }
    }

    ws.onerror = () => {
      // onclose will fire after this
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      reconnectDelay = Math.min(reconnectDelay * 2, 30_000)
      connect()
    }, reconnectDelay)
  }

  function disconnect() {
    shouldReconnect = false
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    ws?.close()
    ws = null
  }

  // Initialize connection
  connect()

  // Build the ClaudeAPI-compatible object
  const api = {
    query: async (prompt: string, options?: { resumeSessionId?: string }) => {
      sendJson({ type: 'query', prompt, resumeSessionId: options?.resumeSessionId })
    },
    interrupt: async () => {
      sendJson({ type: 'interrupt' })
    },
    onMessage: (cb: (msg: unknown) => void) => subscribe(messageCallbacks, cb),
    onError: (cb: (error: string) => void) => subscribe(errorCallbacks, cb),
    onDone: (cb: () => void) => subscribe(doneCallbacks, cb),
    onPermissionRequest: (cb: (req: { id: number; tool: string; input: unknown }) => void) =>
      subscribe(permissionCallbacks, cb),
    respondPermission: (id: number, allowed: boolean) => {
      sendJson({ type: 'permission_response', id, allowed })
    },
    updateSettings: (settings: { autoApproveEdits?: boolean; bashWhitelist?: string[] }) => {
      sendJson({ type: 'settings_update', ...settings })
    },
    selectFolder: async () => null as string | null, // Desktop-only
    listSessions: () => request('list_sessions') as Promise<unknown[]>,
    getSessionMessages: (sessionId: string) =>
      request('get_session_messages', { sessionId }) as Promise<unknown[]>,
    getAccountInfo: () => request('get_account_info'),
    listFiles: (dir?: string) => request('list_files', { dir }) as Promise<string[]>,
    onSessionRefreshHint: (cb: () => void) => subscribe(sessionRefreshCallbacks, cb),

    // Web-only extensions
    onStateSync: (cb: (state: StateSyncPayload) => void) => subscribe(stateSyncCallbacks, cb),
    onDesktopStatus: (cb: (online: boolean) => void) => subscribe(desktopStatusCallbacks, cb),
    disconnect,
  }

  return api
}
