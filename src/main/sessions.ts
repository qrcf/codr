import { listSessions, getSessionMessages, query } from '@anthropic-ai/claude-agent-sdk'
import type { AccountInfo } from '@anthropic-ai/claude-agent-sdk'
import { dialog, ipcMain } from 'electron'

let cachedAccountInfo: AccountInfo | null = null

export function registerSessionHandlers() {
  ipcMain.handle('sessions:list', async () => {
    const sessions = await listSessions({ limit: 100 })
    return sessions
  })

  ipcMain.handle('sessions:get-messages', async (_event, sessionId: string, dir?: string) => {
    const messages = await getSessionMessages(sessionId, {
      ...(dir ? { dir } : {}),
      limit: 200,
    })
    return messages
  })

  ipcMain.handle('sessions:select-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Project Folder',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('sessions:get-account-info', async () => {
    if (cachedAccountInfo) return cachedAccountInfo

    try {
      const probeQuery = query({
        prompt: (async function* () {
          await new Promise(() => {})
        })(),
        options: { persistSession: false },
      })

      cachedAccountInfo = await probeQuery.accountInfo()
      probeQuery.close()
      return cachedAccountInfo
    } catch {
      return null
    }
  })
}
