import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import { ipcMain, type BrowserWindow } from 'electron'
import { createCanUseTool, registerPermissionHandlers } from './permissions'
import type { EventBroadcaster } from './event-broadcaster'

let currentQuery: Query | null = null

export function registerAgentHandlers(
  getMainWindow: () => BrowserWindow | null,
  broadcaster: EventBroadcaster,
) {
  registerPermissionHandlers(broadcaster)

  const canUseTool = createCanUseTool(broadcaster)

  // Run a query (used by both IPC and relay-forwarded commands)
  async function runQuery(prompt: string, resumeSessionId?: string) {
    broadcaster.markQueryStart(prompt)

    currentQuery = query({
      prompt,
      options: {
        includePartialMessages: true,
        canUseTool,
        ...(resumeSessionId ? { resume: resumeSessionId } : {}),
      },
    })

    try {
      for await (const message of currentQuery) {
        broadcaster.send('agent:message', message)
      }
    } catch (err) {
      broadcaster.send('agent:error', String(err))
    } finally {
      currentQuery = null
      broadcaster.send('agent:done')
      broadcaster.send('sessions:refresh-hint')
    }
  }

  async function interruptQuery() {
    if (currentQuery) {
      await currentQuery.interrupt()
    }
  }

  // IPC handlers (Electron renderer)
  ipcMain.handle('agent:query', async (_event, prompt: string, opts?: { resumeSessionId?: string }) => {
    const win = getMainWindow()
    if (!win) return
    await runQuery(prompt, opts?.resumeSessionId)
  })

  ipcMain.handle('agent:interrupt', async () => {
    await interruptQuery()
  })

  // Return functions for relay-forwarded commands
  return { runQuery, interruptQuery }
}
