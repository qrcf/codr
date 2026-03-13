import { listSessions, getSessionMessages, query } from '@anthropic-ai/claude-agent-sdk'
import type { AccountInfo } from '@anthropic-ai/claude-agent-sdk'
import { dialog, ipcMain } from 'electron'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, stat as fsStat } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { homedir } from 'node:os'
import { getCliPath } from './agent'
import type { RelayClient } from './relay-client'
import type { EventBroadcaster } from './event-broadcaster'


// --- Session watcher: detects external changes (e.g., Claude Desktop) ---
// Uses lightweight directory mtime check instead of re-reading all session files.

export function startSessionWatcher(broadcaster: EventBroadcaster): ReturnType<typeof setInterval> {
  let lastDirMtime = 0

  return setInterval(async () => {
    if (broadcaster.hasActiveQueries()) return
    try {
      // Check if the projects directory has changed (lightweight stat, not full scan)
      const projectsDir = join(homedir(), '.claude', 'projects')
      const dirStat = await fsStat(projectsDir).catch(() => null)
      if (!dirStat) return

      const mtime = dirStat.mtimeMs
      if (lastDirMtime === 0) {
        lastDirMtime = mtime
        return
      }
      if (mtime === lastDirMtime) return
      lastDirMtime = mtime

      broadcaster.send('sessions:refresh-hint')
    } catch {
      // Silent failure — SDK may not be ready yet
    }
  }, 5_000)
}

let cachedAccountInfo: AccountInfo | null = null

/** Allow agent.ts to update the cached account info (fallback from real queries). */
export function setCachedAccountInfo(info: AccountInfo | null) {
  if (info) cachedAccountInfo = info
}
let activeTitleGenerations = 0
const MAX_CONCURRENT_TITLES = 3

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.cache',
  '__pycache__', '.venv', 'venv', '.tox', 'coverage', '.nyc_output',
])

// --- Local title cache: survives relay failures so titles never disappear ---
const titleCache = new Map<string, { name: string; firstPrompt: string | null }>()
const titleGenerationBySession = new Map<string, Promise<void>>()

export function cacheTitleLocally(sessionId: string, name: string, firstPrompt?: string | null) {
  titleCache.set(sessionId, { name, firstPrompt: firstPrompt ?? null })
}

// --- Reusable data functions (called by both IPC and relay) ---

export async function listSessionsData(relayClient?: RelayClient) {
  const baseUrl = relayClient?.getApiBaseUrl()

  // Load SDK and DB sessions in parallel
  const [sdkSessions, dbSessions] = await Promise.all([
    listSessions({ limit: 50 }),
    (async () => {
      if (!baseUrl) return null
      try {
        const token = relayClient!.getClerkToken()
        const resp = await fetch(`${baseUrl}/api/sessions`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (resp.ok)
          return (await resp.json()) as Array<{
            sessionId: string
            name: string | null
            firstPrompt: string | null
          }>
      } catch {}
      return null
    })(),
  ])

  // Update local cache with successful DB results
  const dbFetchSucceeded = dbSessions !== null
  for (const s of dbSessions || []) {
    if (s.name) {
      titleCache.set(s.sessionId, { name: s.name, firstPrompt: s.firstPrompt })
    }
  }

  // Build lookup: prefer fresh DB data, fall back to local cache
  const dbMap = new Map<string, { name: string | null; firstPrompt: string | null }>()
  for (const s of dbSessions || []) dbMap.set(s.sessionId, s)

  for (const session of sdkSessions as Array<{
    sessionId?: string
    generatedTitle?: string
    firstPrompt?: string
  }>) {
    if (!session.sessionId) continue
    const dbEntry = dbMap.get(session.sessionId)
    const cached = titleCache.get(session.sessionId)

    // Prefer DB data, fall back to cache
    const name = dbEntry?.name || cached?.name
    const firstPrompt = dbEntry?.firstPrompt || cached?.firstPrompt

    if (name) session.generatedTitle = name
    if (firstPrompt) session.firstPrompt = firstPrompt
  }

  // titlesLoaded = true when DB fetch succeeded OR we have cached titles from a prior fetch
  const titlesLoaded = dbFetchSucceeded || titleCache.size > 0

  return { sessions: sdkSessions, titlesLoaded }
}

async function storeSessionMetadataUnlocked(
  sessionId: string,
  prompt: string,
  relayClient: RelayClient,
  broadcaster: EventBroadcaster,
): Promise<void> {
  const baseUrl = relayClient.getApiBaseUrl()
  if (!baseUrl) return

  // Generate a short title via Claude
  let title = ''
  if (activeTitleGenerations < MAX_CONCURRENT_TITLES) {
    activeTitleGenerations++
    try {
      const truncatedPrompt = prompt.slice(0, 200)
      const cliPath = getCliPath()
      const titleQuery = query({
        prompt: `Respond with ONLY a 3-6 word title in proper case summarizing this message. No quotes, no punctuation at end, no extra text.\n\nMessage: ${truncatedPrompt}`,
        options: {
          model: 'claude-haiku-4-5-20251001',
          thinking: {
              type: 'disabled'
          },
          maxTurns: 1,
          persistSession: false,
          ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
        },
      })

      let streamTitle = ''
      let assistantTitle = ''

      try {
        for await (const message of titleQuery) {
          const msg = message as Record<string, unknown>

          // Handle streaming text deltas (arrives incrementally)
          if (msg.type === 'stream_event') {
            const evt = msg as { event?: { type?: string; delta?: { type?: string; text?: string } } }
            if (evt.event?.type === 'content_block_delta' && evt.event.delta?.type === 'text_delta' && evt.event.delta.text) {
              streamTitle += evt.event.delta.text
            }
          } else if (msg.type === 'assistant') {
            // Handle complete assistant message — content is under msg.message.content
            const assistantMsg = msg as { message?: { content?: Array<{ type?: string; text?: string }> } }
            if (assistantMsg.message?.content) {
              for (const block of assistantMsg.message.content) {
                if (block.type === 'text' && block.text) {
                  assistantTitle += block.text
                }
              }
            }
          }
        }
      } finally {
        titleQuery.close()
      }

      // Prefer stream text (arrives first); fall back to assistant message content
      title = (streamTitle || assistantTitle).trim()
    } catch {
      // Title generation failed — store without title
    } finally {
      activeTitleGenerations--
    }
  }

  // Cache locally so titles survive relay failures
  if (title) {
    cacheTitleLocally(sessionId, title, prompt.slice(0, 500))
  }

  try {
    const token = relayClient.getClerkToken()
    const payload: { firstPrompt: string; name?: string } = { firstPrompt: prompt.slice(0, 500) }
    if (title) payload.name = title
    await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    if (title) {
      broadcaster.send('sessions:refresh-hint')
    }
  } catch {
    // Silent failure — title is still cached locally
  }
}

export async function storeSessionMetadata(
  sessionId: string,
  prompt: string,
  relayClient: RelayClient,
  broadcaster: EventBroadcaster,
): Promise<void> {
  const trimmedPrompt = prompt.trim()
  if (!trimmedPrompt) return

  const existingGeneration = titleGenerationBySession.get(sessionId)
  if (existingGeneration) {
    await existingGeneration
    return
  }

  const generation = storeSessionMetadataUnlocked(sessionId, trimmedPrompt, relayClient, broadcaster)
  titleGenerationBySession.set(sessionId, generation)
  try {
    await generation
  } finally {
    const active = titleGenerationBySession.get(sessionId)
    if (active === generation) {
      titleGenerationBySession.delete(sessionId)
    }
  }
}

export async function getSessionMessagesData(sessionId: string, dir?: string) {
  return getSessionMessages(sessionId, {
    ...(dir ? { dir } : {}),
  })
}

export async function getAccountInfoData() {
  if (cachedAccountInfo) return cachedAccountInfo

  let probeQuery: ReturnType<typeof query> | null = null
  try {
    console.log('[account-info] Starting probe query...')
    const cliPath = getCliPath()
    probeQuery = query({
      prompt: (async function* () {
        await new Promise(() => {})
      })(),
      options: {
        persistSession: false,
        ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
      },
    })

    // Timeout after 10s — the probe query can hang if the CLI is slow to init
    const info = await Promise.race([
      probeQuery.accountInfo(),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('accountInfo timed out after 10s')), 10_000)
      ),
    ])

    console.log('[account-info] Got info:', info ? 'yes' : 'null')
    cachedAccountInfo = info
    return cachedAccountInfo
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[account-info] Failed:', msg)
    return null
  } finally {
    probeQuery?.close()
  }
}

export type CliStatus =
  | { status: 'ready'; accountInfo: AccountInfo }
  | { status: 'not-installed' }
  | { status: 'not-logged-in' }
  | { status: 'error'; message: string }

export async function checkCliStatus(): Promise<CliStatus> {
  if (cachedAccountInfo) {
    return { status: 'ready', accountInfo: cachedAccountInfo }
  }

  // Stage 1: Check if claude binary exists
  const cliPath = getCliPath()
  try {
    if (cliPath) {
      // Packaged build — verify bundled cli.js exists
      if (!existsSync(cliPath)) {
        return { status: 'not-installed' }
      }
    } else {
      // Dev build — check if `claude` is on PATH
      execSync('which claude', { stdio: 'pipe', timeout: 5000 })
    }
  } catch {
    return { status: 'not-installed' }
  }

  // Stage 2: Probe query to check authentication
  let probeQuery: ReturnType<typeof query> | null = null
  const stderrChunks: string[] = []
  try {
    console.log('[cli-status] Starting probe query...')
    probeQuery = query({
      prompt: (async function* () {
        await new Promise(() => {})
      })(),
      options: {
        persistSession: false,
        stderr: (data) => stderrChunks.push(data),
        ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
      },
    })

    const info = await Promise.race([
      probeQuery.accountInfo(),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('accountInfo timed out after 10s')), 10_000)
      ),
    ])

    if (info) {
      console.log('[cli-status] Ready')
      cachedAccountInfo = info
      return { status: 'ready', accountInfo: info }
    }

    return { status: 'not-logged-in' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const stderr = stderrChunks.join('').trim()
    const combined = `${msg} ${stderr}`.toLowerCase()
    console.error('[cli-status] Probe failed:', msg, stderr ? `stderr: ${stderr}` : '')

    if (combined.includes('enoent') || combined.includes('not found') || combined.includes('no such file')) {
      return { status: 'not-installed' }
    }
    if (combined.includes('login') || combined.includes('auth') || combined.includes('not logged') ||
        combined.includes('sign in') || combined.includes('api key') || msg.includes('timed out')) {
      return { status: 'not-logged-in' }
    }

    return { status: 'error', message: msg }
  } finally {
    probeQuery?.close()
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

// --- Backfill title for sessions loaded without one ---

export async function ensureSessionTitle(
  sessionId: string,
  relayClient: RelayClient,
  broadcaster: EventBroadcaster,
  knownFirstPrompt?: string,
): Promise<void> {
  const existingGeneration = titleGenerationBySession.get(sessionId)
  if (existingGeneration) {
    await existingGeneration
    return
  }

  const baseUrl = relayClient.getApiBaseUrl()
  if (!baseUrl) return

  // Check if local cache already has a title (populated by listSessionsData)
  const cached = titleCache.get(sessionId)
  if (cached?.name) return

  // Check DB before generating — title may exist but not be cached yet
  try {
    const token = relayClient.getClerkToken()
    const resp = await fetch(`${baseUrl}/api/sessions`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (resp.ok) {
      const dbSessions = await resp.json() as Array<{
        sessionId: string; name: string | null; firstPrompt: string | null
      }>
      // Populate cache with all DB results
      for (const s of dbSessions) {
        if (s.name) titleCache.set(s.sessionId, { name: s.name, firstPrompt: s.firstPrompt })
      }
      // If this session now has a title, we're done
      const dbEntry = dbSessions.find(s => s.sessionId === sessionId)
      if (dbEntry?.name) {
        broadcaster.send('sessions:refresh-hint')
        return
      }
    }
  } catch {}

  // Use provided prompt to avoid expensive getSessionMessages call
  let firstPrompt = knownFirstPrompt || ''

  if (!firstPrompt) {
    try {
      const messages = await getSessionMessages(sessionId)
      const firstUser = (messages as Array<{ type: string; message?: { content?: string | Array<{ type?: string; text?: string }> } }>)
        .find(m => m.type === 'user')
      if (firstUser?.message?.content) {
        if (typeof firstUser.message.content === 'string') {
          firstPrompt = firstUser.message.content
        } else if (Array.isArray(firstUser.message.content)) {
          const textBlock = firstUser.message.content.find(b => b.type === 'text')
          if (textBlock?.text) firstPrompt = textBlock.text
        }
      }
    } catch {
      return
    }
  }

  if (!firstPrompt) return
  await storeSessionMetadata(sessionId, firstPrompt, relayClient, broadcaster)
}

// --- IPC handlers ---

export function registerSessionHandlers(relayClient?: RelayClient, broadcaster?: EventBroadcaster) {
  ipcMain.handle('sessions:list', async () => {
    return listSessionsData(relayClient)
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

  ipcMain.handle('cli:check-status', async () => {
    return checkCliStatus()
  })

  ipcMain.handle('sessions:list-files', async (_event, dir?: string) => {
    return listFilesData(dir)
  })

  ipcMain.handle('sessions:ensure-title', async (_event, sessionId: string, firstPrompt?: string) => {
    if (!relayClient || !broadcaster) return
    await ensureSessionTitle(sessionId, relayClient, broadcaster, firstPrompt)
  })

  ipcMain.handle('sessions:get-repo-name', async (_event, folderPath: string) => {
    try {
      const url = execSync('git remote get-url origin', {
        cwd: folderPath,
        encoding: 'utf-8',
        timeout: 3000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()
      // SSH: git@github.com:org/repo.git
      const sshMatch = url.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/)
      if (sshMatch) return '@' + sshMatch[1]
      // HTTPS: https://github.com/org/repo.git
      try {
        const parsed = new URL(url)
        const parts = parsed.pathname.replace(/\.git$/, '').split('/').filter(Boolean)
        if (parts.length >= 2) return '@' + parts.slice(-2).join('/')
      } catch { /* not a valid URL, fall through */ }
    } catch { /* not a git repo or no remote */ }
    return basename(folderPath)
  })
}
