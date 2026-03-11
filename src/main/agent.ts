import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import { ipcMain, type BrowserWindow } from 'electron'
import { createCanUseTool, registerPermissionHandlers } from './permissions'

let currentQuery: Query | null = null

export function registerAgentHandlers(getMainWindow: () => BrowserWindow | null) {
  registerPermissionHandlers()

  const canUseTool = createCanUseTool(getMainWindow)

  ipcMain.handle('agent:query', async (_event, prompt: string, opts?: { resumeSessionId?: string }) => {
    const win = getMainWindow()
    if (!win) return

    currentQuery = query({
      prompt,
      options: {
        includePartialMessages: true,
        canUseTool,
        ...(opts?.resumeSessionId ? { resume: opts.resumeSessionId } : {}),
      },
    })

    try {
      for await (const message of currentQuery) {
        if (!win.isDestroyed()) {
          win.webContents.send('agent:message', message)
        }
      }
    } catch (err) {
      if (!win.isDestroyed()) {
        win.webContents.send('agent:error', String(err))
      }
    } finally {
      currentQuery = null
      if (!win.isDestroyed()) {
        win.webContents.send('agent:done')
        win.webContents.send('sessions:refresh-hint')
      }
    }
  })

  ipcMain.handle('agent:interrupt', async () => {
    if (currentQuery) {
      await currentQuery.interrupt()
    }
  })
}
