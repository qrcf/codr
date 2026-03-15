import type { StateSyncPayload, RemoteStatus } from '@codr-works/types'

type Callback<T = void> = T extends void ? () => void : (data: T) => void

interface PendingRequest {
  resolve: (data: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export function createWebSocketAgentAPI(relayUrl: string, getToken: () => Promise<string>) {
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectDelay = 1000
  let shouldReconnect = true

  // Auth gate: buffer request() calls until relay has authenticated us
  let authenticated = false
  let authResolve: () => void
  let authPromise = new Promise<void>((r) => { authResolve = r })

  // Remote status tracking (for RemotePanel in sidebar)
  let desktopOnline = false
  let desktopVersion: string | null = null
  const desktopVersionCallbacks: Array<(version: string | null) => void> = []
  const remoteStatusCallbacks: Array<(status: RemoteStatus) => void> = []

  function getComputedRemoteStatus(): RemoteStatus {
    let status: RemoteStatus['status'] = 'disconnected'
    if (authenticated && desktopOnline) {
      status = 'connected'
    } else if (ws && ws.readyState <= WebSocket.OPEN) {
      // CONNECTING or OPEN but not yet fully authenticated + desktop online
      status = 'connecting'
    }
    return { status, webClients: 0 }
  }

  function fireRemoteStatus() {
    const s = getComputedRemoteStatus()
    for (const cb of remoteStatusCallbacks) cb(s)
  }

  const messageCallbacks: Array<(msg: unknown, querySessionId?: string | null) => void> = []
  const errorCallbacks: Array<(error: string, querySessionId?: string | null) => void> = []
  const doneCallbacks: Array<(querySessionId?: string | null) => void> = []
  const permissionCallbacks: Array<(req: { id: number; tool: string; input: unknown }, querySessionId?: string | null) => void> = []
  const questionCallbacks: Array<(req: { id: number; questions: unknown[] }, querySessionId?: string | null) => void> = []
  const permissionClearedCallbacks: Array<(data: { id: number }, querySessionId?: string | null) => void> = []
  const questionClearedCallbacks: Array<(data: { id: number }, querySessionId?: string | null) => void> = []
  const sessionRefreshCallbacks: Array<() => void> = []
  const stateSyncCallbacks: Array<(state: StateSyncPayload) => void> = []
  const sessionUpdatedCallbacks: Array<(data: { sessionId: string }) => void> = []
  const desktopStatusCallbacks: Array<(online: boolean) => void> = []
  const docCrawlProgressCallbacks: Array<(progress: { sourceId: number; status: string; pagesCrawled: number; currentUrl?: string; error?: string }) => void> = []
  const docsSetupProgressCallbacks: Array<(progress: { step: string; detail?: string; stepIndex: number; totalSteps: number }) => void> = []
  const authFailedCallbacks: Array<() => void> = []
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

  async function request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    // Wait for auth to complete before sending requests
    await authPromise

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
    const qsid = (data.querySessionId as string | null) ?? null
    switch (data.type) {
      case 'agent_message':
        for (const cb of messageCallbacks) cb(data.message, qsid)
        break
      case 'agent_error':
        for (const cb of errorCallbacks) cb(data.error as string, qsid)
        break
      case 'agent_done':
        for (const cb of doneCallbacks) cb(qsid)
        break
      case 'permission_request':
        for (const cb of permissionCallbacks) {
          cb({ id: data.id as number, tool: data.tool as string, input: data.input }, qsid)
        }
        break
      case 'question_request':
        for (const cb of questionCallbacks) {
          cb({ id: data.id as number, questions: data.questions as unknown[] }, qsid)
        }
        break
      case 'permission_cleared':
        for (const cb of permissionClearedCallbacks) {
          cb({ id: data.id as number }, qsid)
        }
        break
      case 'question_cleared':
        for (const cb of questionClearedCallbacks) {
          cb({ id: data.id as number }, qsid)
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
      case 'session_updated':
        for (const cb of sessionUpdatedCallbacks) {
          cb({ sessionId: data.sessionId as string })
        }
        break
      case 'doc_crawl_progress':
        for (const cb of docCrawlProgressCallbacks) {
          cb(data as unknown as { sourceId: number; status: string; pagesCrawled: number; currentUrl?: string; error?: string })
        }
        break
      case 'setup_progress':
        for (const cb of docsSetupProgressCallbacks) {
          cb(data as unknown as { step: string; detail?: string; stepIndex: number; totalSteps: number })
        }
        break
      case 'desktop_status':
        desktopOnline = data.online as boolean
        if (data.desktopVersion !== undefined) {
          desktopVersion = (data.desktopVersion as string) || null
          for (const cb of desktopVersionCallbacks) cb(desktopVersion)
        }
        for (const cb of desktopStatusCallbacks) cb(desktopOnline)
        fireRemoteStatus()
        break
      case 'auth_result':
        if (data.success) {
          authenticated = true
          authResolve()
        } else {
          for (const cb of authFailedCallbacks) cb()
        }
        if (data.desktopOnline !== undefined) {
          desktopOnline = data.desktopOnline as boolean
          for (const cb of desktopStatusCallbacks) cb(desktopOnline)
        }
        if (data.desktopVersion !== undefined) {
          desktopVersion = (data.desktopVersion as string) || null
          for (const cb of desktopVersionCallbacks) cb(desktopVersion)
        }
        fireRemoteStatus()
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
      fireRemoteStatus()
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
      // Reset auth gate so requests buffer until next auth_result
      if (authenticated) {
        authenticated = false
        authPromise = new Promise<void>((r) => { authResolve = r })
      }
      desktopOnline = false
      fireRemoteStatus()
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

  // Build the CodrAPI-compatible object
  return {
    getProvider: async () => {
      const res = await request('get_provider') as { provider?: 'claude' | 'codex' }
      return res.provider || 'claude'
    },
    setProvider: async (provider: 'claude' | 'codex') => {
      return request('set_provider', { provider }) as Promise<{ provider?: 'claude' | 'codex'; error?: string }>
    },
    getModels: async (provider?: 'claude' | 'codex') => {
      return request('get_models', provider ? { provider } : undefined) as Promise<{ models: Array<{ value: string; displayName: string }>; selectedModel?: string }>
    },
    setModel: async (provider: 'claude' | 'codex', model: string | undefined) => {
      return request('set_model', { provider, model }) as Promise<{ model?: string }>
    },
    query: async (prompt: string, options?: { resumeSessionId?: string; planMode?: boolean; askMode?: boolean; cwd?: string; model?: string; thinkingBudget?: 'low' | 'medium' | 'high' }) => {
      sendJson({ type: 'query', prompt, resumeSessionId: options?.resumeSessionId, planMode: options?.planMode, askMode: options?.askMode, cwd: options?.cwd, model: options?.model, thinkingBudget: options?.thinkingBudget })
    },
    interrupt: async (sessionId?: string) => {
      sendJson({ type: 'interrupt', sessionId })
    },
    getAgentState: (sessionId?: string) =>
      request('get_agent_state', sessionId ? { sessionId } : undefined) as Promise<{ isLoading: boolean; streamingText: string; streamingThinking: string; streamingTools: unknown[]; permissionRequest?: unknown; questionRequest?: unknown; planReview?: unknown; querySessionId?: string | null }>,
    onMessage: (cb: (msg: unknown, querySessionId?: string | null) => void) => subscribe(messageCallbacks, cb),
    onError: (cb: (error: string, querySessionId?: string | null) => void) => subscribe(errorCallbacks, cb),
    onDone: (cb: (querySessionId?: string | null) => void) => subscribe(doneCallbacks, cb),
    onPermissionRequest: (cb: (req: { id: number; tool: string; input: unknown }, querySessionId?: string | null) => void) =>
      subscribe(permissionCallbacks, cb),
    respondPermission: (id: number, allowed: boolean, opts?: { alwaysAllow?: boolean; toolName?: string; message?: string }) => {
      sendJson({ type: 'permission_response', id, allowed, ...opts })
    },
    onPermissionCleared: (cb: (data: { id: number }, querySessionId?: string | null) => void) =>
      subscribe(permissionClearedCallbacks, cb),
    onQuestionRequest: (cb: (req: { id: number; questions: unknown[] }, querySessionId?: string | null) => void) =>
      subscribe(questionCallbacks, cb),
    onQuestionCleared: (cb: (data: { id: number }, querySessionId?: string | null) => void) =>
      subscribe(questionClearedCallbacks, cb),
    respondQuestion: (id: number, answers: Record<string, string>) => {
      sendJson({ type: 'question_response', id, answers })
    },
    updateSettings: (settings: { autoApproveEdits?: boolean; bashWhitelist?: string[] }) => {
      sendJson({ type: 'settings_update', ...settings })
    },
    selectFolder: async () => null as string | null, // Desktop-only
    listSessions: () => request('list_sessions') as Promise<{ sessions: unknown[]; titlesLoaded: boolean }>,
    getSessionMessages: (sessionId: string) =>
      request('get_session_messages', { sessionId }) as Promise<unknown[]>,
    getAccountInfo: () => request('get_account_info'),
    onAccountInfoUpdate: () => () => {}, // Account info push is desktop-only (IPC)
    listFiles: (dir?: string) => request('list_files', { dir }) as Promise<string[]>,
    readPlanFile: (filePath: string) =>
      request('read_plan_file', { filePath }) as Promise<{ content?: string; error?: string }>,
    onSessionRefreshHint: (cb: () => void) => subscribe(sessionRefreshCallbacks, cb),
    onSessionUpdated: (cb: (data: { sessionId: string }) => void) => subscribe(sessionUpdatedCallbacks, cb),

    // Remote status (consumed by RemotePanel in sidebar)
    getRemoteStatus: async () => getComputedRemoteStatus(),
    onRemoteStatusChange: (cb: (status: RemoteStatus) => void) => subscribe(remoteStatusCallbacks, cb),

    // Docs feature — crawl operations route through desktop via relay
    addDocSource: (source: { url: string; name: string; crawlDepth?: number; prefix?: string }) =>
      request('add_doc_source', source as Record<string, unknown>),
    removeDocSource: (sourceId: number) =>
      request('remove_doc_source', { sourceId }),
    recrawlDocSource: (sourceId: number, url: string, crawlDepth: number, prefix?: string) =>
      request('recrawl_doc_source', { sourceId, url, crawlDepth, prefix }),
    cancelDocCrawl: (sourceId: number) =>
      request('cancel_doc_crawl', { sourceId }),
    onDocsCrawlProgress: (cb: (progress: { sourceId: number; status: string; pagesCrawled: number; currentUrl?: string; error?: string }) => void) =>
      subscribe(docCrawlProgressCallbacks, cb),
    onDocsSetupProgress: (cb: (progress: { step: string; detail?: string; stepIndex: number; totalSteps: number }) => void) =>
      subscribe(docsSetupProgressCallbacks, cb),
    fetchDocTitle: (url: string) =>
      request('fetch_doc_title', { url }) as Promise<{ title: string | null }>,

    // Project Indexer
    indexerSearch: (query: string, projectDir: string) =>
      request('indexer_search', { query, projectDir }) as Promise<{ path: string; score: number; text: string }[]>,
    getIndexerStatus: () =>
      request('indexer_status', {}) as Promise<{ status: string; detail?: string }>,
    getIndexerProjectStatus: (projectDir: string) =>
      request('indexer_project_status', { projectDir }) as Promise<{ status: string; fileCount?: number; detail?: string }>,
    getIndexerProjectFiles: (projectDir: string) =>
      request('indexer_project_files', { projectDir }) as Promise<{ path: string; chunkCount: number; language: string; size: number }[]>,
    rebuildIndex: (projectDir: string) =>
      request('indexer_rebuild', { projectDir }) as Promise<{ ok: boolean }>,
    reinstallIndexer: () =>
      request('indexer_reinstall', {}) as Promise<{ ok: boolean }>,
    onIndexerSetupProgress: () => () => {}, // Setup progress is desktop-only

    // Web-only extensions
    onStateSync: (cb: (state: StateSyncPayload) => void) => subscribe(stateSyncCallbacks, cb),
    onDesktopStatus: (cb: (online: boolean) => void) => subscribe(desktopStatusCallbacks, cb),
    onDesktopVersion: (cb: (version: string | null) => void) => subscribe(desktopVersionCallbacks, cb),
    onAuthFailed: (cb: () => void) => subscribe(authFailedCallbacks, cb),
    disconnect,
  }
}

export const createWebSocketCodrAPI = createWebSocketAgentAPI
