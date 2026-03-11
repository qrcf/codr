import path from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { registerAgentHandlers } from './agent'
import { registerSessionHandlers, listSessionsData, getSessionMessagesData, getAccountInfoData, listFilesData } from './sessions'
import { resolvePermission, updateSettings } from './permissions'
import { EventBroadcaster } from './event-broadcaster'
import { RelayClient } from './relay-client'

let mainWindow: BrowserWindow | null = null

const relayClient = new RelayClient()
const broadcaster = new EventBroadcaster(() => mainWindow)
broadcaster.setRelayClient(relayClient)

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

// Handle relay-forwarded messages from web clients
let agentHandlers: { runQuery: (prompt: string, resumeSessionId?: string) => Promise<void>; interruptQuery: () => Promise<void> } | null = null

relayClient.onMessage(async (msg) => {
  switch (msg.type) {
    case 'query': {
      const prompt = msg.prompt as string
      const resumeSessionId = msg.resumeSessionId as string | undefined
      if (agentHandlers && prompt) {
        await agentHandlers.runQuery(prompt, resumeSessionId)
      }
      break
    }
    case 'interrupt': {
      await agentHandlers?.interruptQuery()
      break
    }
    case 'permission_response': {
      resolvePermission(msg.id as number, msg.allowed as boolean)
      break
    }
    case 'settings_update': {
      updateSettings(msg as { autoApproveEdits?: boolean; bashWhitelist?: string[] })
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
            data = await listSessionsData()
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
})

app.whenReady().then(() => {
  agentHandlers = registerAgentHandlers(() => mainWindow, broadcaster)
  registerSessionHandlers()

  // Remote access IPC handlers
  ipcMain.handle('remote:connect', async (_event, relayUrl: string, clerkToken: string) => {
    relayClient.connect(relayUrl, clerkToken)
  })

  ipcMain.handle('remote:disconnect', async () => {
    relayClient.disconnect()
  })

  ipcMain.handle('remote:status', async () => {
    return relayClient.getStatus()
  })

  createWindow()

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
  relayClient.disconnect()
})
