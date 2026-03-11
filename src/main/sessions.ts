import { listSessions, getSessionMessages, query } from '@anthropic-ai/claude-agent-sdk'
import type { AccountInfo } from '@anthropic-ai/claude-agent-sdk'
import { dialog, ipcMain } from 'electron'
import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

let cachedAccountInfo: AccountInfo | null = null

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.cache',
  '__pycache__', '.venv', 'venv', '.tox', 'coverage', '.nyc_output',
])

// --- Reusable data functions (called by both IPC and relay) ---

export async function listSessionsData() {
  return listSessions({ limit: 100 })
}

export async function getSessionMessagesData(sessionId: string, dir?: string) {
  return getSessionMessages(sessionId, {
    ...(dir ? { dir } : {}),
    limit: 200,
  })
}

export async function getAccountInfoData() {
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
}

export async function listFilesData(dir?: string) {
  const root = dir || process.cwd()
  const results: string[] = []
  const MAX_FILES = 500

  async function walk(current: string) {
    if (results.length >= MAX_FILES) return
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (results.length >= MAX_FILES) break
      if (entry.name.startsWith('.') && entry.isDirectory()) continue
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue
        await walk(join(current, entry.name))
      } else {
        results.push(relative(root, join(current, entry.name)))
      }
    }
  }

  await walk(root)
  return results.sort()
}

// --- IPC handlers ---

export function registerSessionHandlers() {
  ipcMain.handle('sessions:list', async () => {
    return listSessionsData()
  })

  ipcMain.handle('sessions:get-messages', async (_event, sessionId: string, dir?: string) => {
    return getSessionMessagesData(sessionId, dir)
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
    return getAccountInfoData()
  })

  ipcMain.handle('sessions:list-files', async (_event, dir?: string) => {
    return listFilesData(dir)
  })
}
