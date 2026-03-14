declare const __WEB_URL__: string
declare const __API_URL__: string
declare const __RELAY_URL__: string

import fixPath from 'fix-path'
import path from 'node:path'
import { readFile, writeFile, stat, unlink } from 'node:fs/promises'
import { app, BrowserWindow, clipboard, ipcMain, Menu, nativeImage, safeStorage, shell } from 'electron'

// macOS GUI apps get a minimal PATH (/usr/bin:/bin). Restore the user's full
// shell PATH so the Claude Agent SDK can find the `claude` CLI binary.
fixPath()

// The Claude Agent SDK bundles graceful-fs which registers multiple process exit
// listeners. Raise the limit to suppress the spurious MaxListenersExceededWarning.
process.setMaxListeners(20)

import { registerAgentHandlers } from './agent'
import { registerSessionHandlers, listSessionsData, getSessionMessagesData, getAccountInfoData, listFilesData, startSessionWatcher } from './sessions'
import { resolvePermission, resolveQuestion, updateSettings, approveToolForSession, type MessageOrigin } from './permissions'
import { getSelectedProvider, setSelectedProvider, getSelectedModel, setSelectedModel } from './runtime/provider-config'
import { getModelsForProvider } from './runtime/models'
import { EventBroadcaster } from './event-broadcaster'
import { RelayClient } from './relay-client'
import {createDocsManager, type DocsManager, fetchPageTitle} from './docs/manager'
import { loadWindowState, trackWindowState } from './window-state'
import { initAutoUpdater, checkForUpdates, quitAndInstall, getUpdateState } from './auto-updater'
import { IndexerManager } from './indexer/manager'

let mainWindow: BrowserWindow | null = null
const indexerManager = new IndexerManager()
let initialized = false
let sessionWatcherInterval: ReturnType<typeof setInterval> | null = null
let docsManager: DocsManager | null = null

const relayClient = new RelayClient()
relayClient.setApiUrl(__API_URL__)
const broadcaster = new EventBroadcaster(() => mainWindow)
broadcaster.setRelayClient(relayClient)

// --- Deep link protocol registration ---
// Register codr:// protocol for OAuth callback from system browser
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('codr', process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient('codr')
}

// Single instance lock — second instance passes deep link to first
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
}

// --- Token storage (safeStorage + file on disk) ---
const TOKEN_PATH = path.join(app.getPath('userData'), 'auth-token')

async function loadStoredToken(): Promise<string | null> {
  try {
    const data = await readFile(TOKEN_PATH)
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(data)
    }
    // Fallback: stored as plain text
    return data.toString('utf-8')
  } catch {
    return null
  }
}

async function storeToken(token: string): Promise<void> {
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(token)
    await writeFile(TOKEN_PATH, encrypted)
  } else {
    await writeFile(TOKEN_PATH, token, 'utf-8')
  }
}

async function clearStoredToken(): Promise<void> {
  try { await unlink(TOKEN_PATH) } catch { /* ignore */ }
}

async function getAuthToken(): Promise<string> {
  const token = await loadStoredToken()
  if (!token) throw new Error('No auth token')
  return token
}

// Store deep link URL if received before window is ready
let pendingDeepLink: string | null = null

function handleDeepLink(url: string) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'codr:' && parsed.hostname === 'auth') {
      const token = parsed.searchParams.get('token')
      if (token) {
        storeToken(token).then(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('auth:token-stored', token)
          }
          // Auto-connect relay with new token
          if (__RELAY_URL__) {
            relayClient.connect(__RELAY_URL__, token, app.getVersion())
          }
        })
        if (!mainWindow || mainWindow.isDestroyed()) {
          pendingDeepLink = url
        }
      }
    }
  } catch {
    // Invalid URL, ignore
  }

  // Focus the main window
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
}

// macOS: app is already running, URL opened
app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDeepLink(url)
})

// Windows/Linux: second instance launched with URL
app.on('second-instance', (_event, commandLine) => {
  const url = commandLine.find(arg => arg.startsWith('codr://'))
  if (url) handleDeepLink(url)
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

// --- Window creation ---
function createWindow() {
  const savedState = loadWindowState()

  mainWindow = new BrowserWindow({
    width: savedState?.width ?? 1000,
    height: savedState?.height ?? 700,
    ...(savedState?.x != null && savedState?.y != null
      ? { x: savedState.x, y: savedState.y }
      : {}),
    icon: path.join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (savedState?.isMaximized) {
    mainWindow.maximize()
  }
  trackWindowState(mainWindow)

  // All external URLs open in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('about:') || url.startsWith('devtools:')) {
      return { action: 'allow' }
    }
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Block all external navigation in the main window
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const appUrl = process.env['ELECTRON_RENDERER_URL'] || __WEB_URL__ || 'file://'
    if (!url.startsWith(appUrl) && !url.startsWith('file://')) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else if (__WEB_URL__) {
    mainWindow.loadURL(__WEB_URL__)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // Process any deep link that arrived before the window was ready
  if (pendingDeepLink) {
    handleDeepLink(pendingDeepLink)
    pendingDeepLink = null
  }
}

// Initialize docs manager (lazy)
function ensureDocsManager(): DocsManager {
  if (!docsManager) {
    docsManager = createDocsManager({
      apiUrl: relayClient.getApiBaseUrl() || '',
      getAuthToken: () => getAuthToken(),
      broadcaster,
    })
  }
  return docsManager
}

// Handle relay-forwarded messages from web clients
let agentHandlers: { runQuery: (prompt: string, resumeSessionId?: string, planMode?: boolean, cwd?: string, askMode?: boolean, origin?: MessageOrigin, model?: string, thinkingBudget?: 'low' | 'medium' | 'high') => Promise<void>; interruptQuery: (sessionId?: string) => Promise<void> } | null = null

relayClient.onMessage(async (msg) => {
  switch (msg.type) {
    case 'query': {
      const prompt = msg.prompt as string
      const resumeSessionId = msg.resumeSessionId as string | undefined
      const planMode = msg.planMode as boolean | undefined
      const cwd = msg.cwd as string | undefined
      const askMode = msg.askMode as boolean | undefined
      const model = msg.model as string | undefined
      const thinkingBudget = msg.thinkingBudget as 'low' | 'medium' | 'high' | undefined
      if (agentHandlers && prompt) {
        await agentHandlers.runQuery(prompt, resumeSessionId, planMode, cwd, askMode, 'remote', model, thinkingBudget)
      }
      break
    }
    case 'interrupt': {
      await agentHandlers?.interruptQuery(msg.sessionId as string | undefined)
      break
    }
    case 'permission_response': {
      if (msg.alwaysAllow && msg.toolName) {
        approveToolForSession(msg.toolName as string, 'remote')
      }
      resolvePermission(msg.id as number, msg.allowed as boolean, msg.message as string | undefined, 'remote')
      broadcaster.clearPermissionRequest(msg.id as number)
      break
    }
    case 'question_response': {
      resolveQuestion(msg.id as number, msg.answers as Record<string, string>)
      broadcaster.clearQuestionRequest(msg.id as number)
      break
    }
    case 'settings_update': {
      updateSettings(msg as { autoApproveEdits?: boolean; bashWhitelist?: string[] }, 'remote')
      break
    }
    case 'request_state_sync': {
      broadcaster.sendStateSync()
      break
    }
    case 'request': {
      // Handle request/response calls from web client
      const requestId = msg.requestId as string
      const method = msg.method as string
      const params = msg.params as Record<string, unknown> | undefined
      let data: unknown = null

      try {
        switch (method) {
          case 'list_sessions':
            data = await listSessionsData(relayClient, getAuthToken)
            break
          case 'get_session_messages':
            data = await getSessionMessagesData(params?.sessionId as string, params?.dir as string | undefined)
            break
          case 'get_account_info':
            data = await getAccountInfoData()
            break
          case 'list_files':
            data = await listFilesData(params?.dir as string | undefined)
            break
          case 'get_agent_state':
            data = broadcaster.getState(params?.sessionId as string | undefined)
            break
          case 'get_provider':
            data = { provider: await getSelectedProvider() }
            break
          case 'set_provider': {
            const provider = params?.provider as 'claude' | 'codex'
            if (provider !== 'claude' && provider !== 'codex') {
              data = { error: 'Invalid provider' }
            } else {
              const selected = await setSelectedProvider(provider)
              broadcaster.send('sessions:refresh-hint')
              data = { provider: selected }
            }
            break
          }
          case 'get_models': {
            const p = (params?.provider as AgentProviderId) || await getSelectedProvider()
            const [models, selectedModel] = await Promise.all([
              getModelsForProvider(p),
              getSelectedModel(p),
            ])
            data = { models, selectedModel }
            break
          }
          case 'set_model': {
            const smProvider = params?.provider as AgentProviderId
            const smModel = params?.model as string | undefined
            if (smProvider === 'claude' || smProvider === 'codex') {
              await setSelectedModel(smProvider, smModel)
              data = { model: smModel }
            } else {
              data = { error: 'Invalid provider' }
            }
            break
          }
          case 'add_doc_source': {
            const mgr = ensureDocsManager()
            const crawlDepth = params?.crawlDepth ? Math.min(params.crawlDepth as number, 10) : undefined
            data = await mgr.addSource(
              params?.url as string,
              params?.name as string,
              crawlDepth,
              params?.prefix as string | undefined
            )
            break
          }
          case 'remove_doc_source': {
            const mgr = ensureDocsManager()
            await mgr.removeSource(params?.sourceId as number)
            data = { ok: true }
            break
          }
          case 'recrawl_doc_source': {
            const mgr = ensureDocsManager()
            await mgr.recrawlSource(
              params?.sourceId as number,
              params?.url as string,
              params?.crawlDepth as number,
              params?.prefix as string | undefined
            )
            data = { ok: true }
            break
          }
          case 'cancel_doc_crawl': {
            const mgr = ensureDocsManager()
            data = { ok: mgr.cancelCrawl(params?.sourceId as number) }
            break
          }
          case 'fetch_doc_title': {
            const title = await fetchPageTitle(params?.url as string)
            data = { title }
            break
          }
          case 'read_plan_file': {
            const filePath = params?.filePath as string
            if (!filePath?.includes('.claude/plans/')) {
              data = { error: 'Invalid plan file path' }
            } else {
              try {
                const content = await readFile(filePath, 'utf-8')
                data = { content }
              } catch {
                data = { error: 'Could not read plan file' }
              }
            }
            break
          }
          case 'indexer_search':
            data = await indexerManager.search(params?.query as string, params?.projectDir as string)
            break
          case 'indexer_status':
            data = indexerManager.getStatus()
            break
          case 'indexer_project_status':
            data = indexerManager.getProjectStatus(params?.projectDir as string)
            break
          case 'indexer_project_files':
            data = indexerManager.getProjectFiles(params?.projectDir as string)
            break
          case 'indexer_rebuild':
            await indexerManager.buildIndex(params?.projectDir as string)
            data = { ok: true }
            break
          case 'indexer_reinstall':
            await indexerManager.reinstall()
            data = { ok: true }
            break
        }
      } catch (err) {
        data = { error: String(err) }
      }

      relayClient.send({ type: 'response', requestId, data })
      break
    }
  }
})

// Forward relay status changes to Electron renderer
relayClient.onStatusChange((status, webClients) => {
  const win = mainWindow
  if (win && !win.isDestroyed()) {
    win.webContents.send('remote:status-change', { status, webClients })
  }
  // Refresh sessions when relay connects so titles load from DB
  if (status === 'connected') {
    broadcaster.send('sessions:refresh-hint')
    // Reset any doc sources stuck in 'crawling' from a previous session
    ensureDocsManager()
  }
})

app.setName('Codr')

app.whenReady().then(() => {
  if (initialized) return
  initialized = true

  if (process.platform === 'darwin') {
    const icon = nativeImage.createFromPath(path.join(__dirname, '../../build/icon.png'))
    app.dock?.setIcon(icon)
  }

  function buildAppMenu() {
    if (process.platform !== 'darwin') return
    const pendingVersion = getUpdateState()
    const updateMenuItem: Electron.MenuItemConstructorOptions = pendingVersion
      ? { label: `Restart to Update (v${pendingVersion})`, click: () => quitAndInstall() }
      : { label: 'Check for Update...', click: () => checkForUpdates(true) }

    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: 'Codr',
        submenu: [
          { role: 'about' },
          updateMenuItem,
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }

  buildAppMenu()

  agentHandlers = registerAgentHandlers(() => mainWindow, broadcaster, relayClient, getAuthToken, indexerManager)
  registerSessionHandlers(relayClient, broadcaster, getAuthToken)
  sessionWatcherInterval = startSessionWatcher(broadcaster)

  // Expose current agent state (isLoading, streaming content) to renderer
  ipcMain.handle('agent:get-state', (_event, sessionId?: string) => broadcaster.getState(sessionId))

  // Clipboard: read file paths from native pasteboard (macOS Finder Cmd+C)
  ipcMain.handle('clipboard:read-file-paths', () => {
    const formats = clipboard.availableFormats()
    if (formats.some(f => f.includes('FileName') || f.includes('file-url'))) {
      try {
        const plistXml = clipboard.read('NSFilenamesPboardType')
        if (!plistXml) return []
        const paths: string[] = []
        const regex = /<string>(.*?)<\/string>/g
        let match: RegExpExecArray | null
        while ((match = regex.exec(plistXml)) !== null) {
          const p = match[1]
          if (p && p.startsWith('/')) paths.push(p)
        }
        return paths
      } catch {
        return []
      }
    }
    return []
  })

  // Remote access IPC handlers
  ipcMain.handle('remote:connect', async () => {
    const token = await loadStoredToken()
    if (token && __RELAY_URL__) {
      relayClient.connect(__RELAY_URL__, token, app.getVersion())
    }
  })

  ipcMain.handle('remote:disconnect', async () => {
    relayClient.disconnect()
  })

  ipcMain.handle('remote:status', async () => {
    return relayClient.getStatus()
  })

  // Auth: open web client in system browser for OAuth
  ipcMain.handle('auth:open-browser', async (_event, url: string) => {
    shell.openExternal(url)
  })

  // Auth: get stored token
  ipcMain.handle('auth:get-token', async () => loadStoredToken())

  // Auth: sign out (clear token + disconnect relay)
  ipcMain.handle('auth:sign-out', async () => {
    await clearStoredToken()
    relayClient.disconnect()
  })

  // User profile from Clerk (via API)
  ipcMain.handle('user:get-profile', async () => {
    const token = await loadStoredToken()
    if (!token || !__API_URL__) return null
    try {
      const res = await fetch(`${__API_URL__}/api/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return null
      return await res.json()
    } catch {
      return null
    }
  })

  // Project CLAUDE.md reader/writer
  ipcMain.handle('project:read-claude-md', async (_event, folderPath: string) => {
    if (!folderPath) return { error: 'No folder path provided' }
    try {
      const s = await stat(folderPath)
      if (!s.isDirectory()) return { error: 'Path is not a directory' }
    } catch {
      return { error: 'Folder does not exist' }
    }
    const filePath = `${folderPath}/CLAUDE.md`
    try {
      const content = await readFile(filePath, 'utf-8')
      return { content }
    } catch {
      return { content: null }
    }
  })

  ipcMain.handle('project:write-claude-md', async (_event, folderPath: string, content: string) => {
    if (!folderPath) return { error: 'No folder path provided' }
    try {
      const s = await stat(folderPath)
      if (!s.isDirectory()) return { error: 'Path is not a directory' }
    } catch {
      return { error: 'Folder does not exist' }
    }
    const filePath = `${folderPath}/CLAUDE.md`
    try {
      await writeFile(filePath, content, 'utf-8')
      return { ok: true }
    } catch (err) {
      return { error: `Could not write CLAUDE.md: ${err}` }
    }
  })

  // Plan file reader (fallback for loading historical sessions)
  ipcMain.handle('plan:read-file', async (_event, filePath: string) => {
    if (!filePath?.includes('.claude/plans/')) {
      return { error: 'Invalid plan file path' }
    }
    try {
      const content = await readFile(filePath, 'utf-8')
      return { content }
    } catch {
      return { error: 'Could not read plan file' }
    }
  })

  // ── Docs feature IPC handlers ──────────────────────────────────────

  ipcMain.handle('docs:add-source', async (_event, source: { url: string; name: string; crawlDepth?: number; prefix?: string }) => {
    try {
      const mgr = ensureDocsManager()
      return await mgr.addSource(source.url, source.name, source.crawlDepth, source.prefix)
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('docs:remove-source', async (_event, sourceId: number) => {
    try {
      const mgr = ensureDocsManager()
      await mgr.removeSource(sourceId)
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('docs:recrawl', async (_event, sourceId: number, url: string, crawlDepth: number, prefix?: string) => {
    try {
      const mgr = ensureDocsManager()
      await mgr.recrawlSource(sourceId, url, crawlDepth, prefix)
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('docs:cancel-crawl', async (_event, sourceId: number) => {
    try {
      const mgr = ensureDocsManager()
      const cancelled = mgr.cancelCrawl(sourceId)
      return { ok: cancelled }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('docs:reinstall-runtime', async () => {
    try {
      const { resetPythonRuntime } = await import('./docs/python-runtime.js')
      await resetPythonRuntime()
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('docs:fetch-title', async (_event, url: string) => {
    const title = await fetchPageTitle(url)
    return { title }
  })

  createWindow()

  // Auto-connect relay if we have a stored token
  loadStoredToken().then((token) => {
    if (token && __RELAY_URL__) {
      relayClient.connect(__RELAY_URL__, token, app.getVersion())
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('auth:token-stored', token)
      }
    }
  })

  // Auto-updater (packaged builds only)
  if (app.isPackaged) {
    initAutoUpdater(mainWindow!, buildAppMenu)
  }

  ipcMain.handle('updater:install', () => quitAndInstall())

  // Project Indexer
  indexerManager.startSetup((progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('indexer:setup-progress', progress)
    }
  })

  ipcMain.handle('indexer:search', async (_event, query: string, projectDir: string) => {
    return indexerManager.search(query, projectDir)
  })
  ipcMain.handle('indexer:status', async () => {
    return indexerManager.getStatus()
  })
  ipcMain.handle('indexer:project-status', async (_event, projectDir: string) => {
    return indexerManager.getProjectStatus(projectDir)
  })
  ipcMain.handle('indexer:project-files', async (_event, projectDir: string) => {
    return indexerManager.getProjectFiles(projectDir)
  })
  ipcMain.handle('indexer:rebuild', async (_event, projectDir: string) => {
    await indexerManager.buildIndex(projectDir)
    return { ok: true }
  })
  ipcMain.handle('indexer:reinstall', async () => {
    await indexerManager.reinstall()
    return { ok: true }
  })

  // Check if launched via deep link (cold start)
  const deepLinkArg = process.argv.find(arg => arg.startsWith('codr://'))
  if (deepLinkArg) handleDeepLink(deepLinkArg)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  if (sessionWatcherInterval) {
    clearInterval(sessionWatcherInterval)
    sessionWatcherInterval = null
  }
  indexerManager.shutdown().catch(() => {})
  relayClient.disconnect()
})
