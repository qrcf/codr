import { listSessions, getSessionMessages, query } from '@anthropic-ai/claude-agent-sdk'
import type { AccountInfo } from '@anthropic-ai/claude-agent-sdk'
import type { SessionInfo } from '@codr-works/types'
import { dialog, ipcMain } from 'electron'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, readdir, stat as fsStat } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import ignore from 'ignore'
import { homedir } from 'node:os'
import { getCliPath } from './agent'
import type { RelayClient } from './relay-client'
import type { EventBroadcaster } from './event-broadcaster'
import { getSelectedProvider } from './runtime/provider-config'
import { getIndexedSessionMessages, getIndexedSessionMeta, listIndexedSessions, putIndexedRawMessages, upsertIndexedSession } from './runtime/session-index'
import { buildSessionList, shouldUseIndexedMessages, type ClaudeDbSessionMeta } from './runtime/session-records'
import { listCodexThreads, getCodexThreadRolloutPath, getCodexDbPath_exported } from './runtime/codex-discovery'
import { parseCodexRollout } from './runtime/codex-rollout-parser'


// --- Session watcher: detects external changes (e.g., Claude Desktop, Codex Desktop) ---
// Uses lightweight mtime checks instead of re-reading all session files.

export function startSessionWatcher(broadcaster: EventBroadcaster): ReturnType<typeof setInterval> {
  let lastClaudeMtime = 0
  let lastCodexMtime = 0

  return setInterval(async () => {
    if (broadcaster.hasActiveQueries()) return
    try {
      let changed = false

      // Claude: check ~/.claude/projects directory mtime
      const claudeProjectsDir = join(homedir(), '.claude', 'projects')
      const claudeStat = await fsStat(claudeProjectsDir).catch(() => null)
      if (claudeStat) {
        const mtime = claudeStat.mtimeMs
        if (lastClaudeMtime === 0) {
          lastClaudeMtime = mtime
        } else if (mtime !== lastClaudeMtime) {
          lastClaudeMtime = mtime
          changed = true
        }
      }

      // Codex: check ~/.codex/state_5.sqlite mtime
      const codexDbPath = getCodexDbPath_exported()
      const codexStat = await fsStat(codexDbPath).catch(() => null)
      if (codexStat) {
        const mtime = codexStat.mtimeMs
        if (lastCodexMtime === 0) {
          lastCodexMtime = mtime
        } else if (mtime !== lastCodexMtime) {
          lastCodexMtime = mtime
          changed = true
        }
      }

      if (changed) broadcaster.send('sessions:refresh-hint')
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
import { IGNORED_DIRS, IGNORE_FILES } from './runtime/files-config'
export { IGNORED_DIRS, IGNORE_FILES }

async function loadIgnoreRules(rootDir: string, config?: import('./runtime/files-config').ResolvedFilesConfig) {
  const ig = ignore()
  const dirsToIgnore = config?.ignoreDirs ?? Array.from(IGNORED_DIRS)
  ig.add(dirsToIgnore.map(d => d + '/'))
  for (const file of IGNORE_FILES) {
    try {
      const content = await readFile(join(rootDir, file), 'utf-8')
      ig.add(content)
    } catch { /* file doesn't exist */ }
  }
  if (config?.extraIgnoreFiles.length) {
    const standardNames = new Set(IGNORE_FILES)
    for (const file of config.extraIgnoreFiles) {
      if (standardNames.has(file)) continue
      try {
        const content = await readFile(join(rootDir, file), 'utf-8')
        ig.add(content)
      } catch { /* file doesn't exist */ }
    }
  }
  if (config?.extraPatterns.length) {
    ig.add(config.extraPatterns)
  }
  return ig
}

// --- Auth failure handler: called when API returns 401 ---
let authFailureHandler: (() => void) | null = null

export function setAuthFailureHandler(handler: () => void): void {
  authFailureHandler = handler
}

// --- Title generation: index-based, provider-first ---

const titleGenerationBySession = new Map<string, Promise<void>>()
let moduleRelayClient: RelayClient | undefined
let moduleBroadcaster: EventBroadcaster | undefined

// --- Reusable data functions (called by both IPC and relay) ---

export async function listSessionsData(relayClient?: RelayClient, getAuthToken?: () => Promise<string>) {
  const baseUrl = relayClient?.getApiBaseUrl()

  // listCodexThreads is synchronous (node:sqlite) — run it alongside async calls
  const codexThreads = listCodexThreads()
  const [sdkSessions, dbSessions] = await Promise.all([
    listSessions({ limit: 50 }).catch(() => []),
    baseUrl
      ? (async () => {
          try {
            const token = getAuthToken ? await getAuthToken() : relayClient!.getAuthToken()
            const resp = await fetch(`${baseUrl}/api/sessions`, {
              headers: { Authorization: `Bearer ${token}` },
            })
            if (resp.ok) return (await resp.json()) as ClaudeDbSessionMeta[]
            if (resp.status === 401) authFailureHandler?.()
          } catch { /* empty */ }
          return null
        })()
      : Promise.resolve(null),
  ])

  const dbFetchSucceeded = dbSessions !== null

  // Keep the shared index fresh with Claude session discovery, regardless of selected provider.
  await Promise.all(
    (sdkSessions as Array<{ sessionId?: string; generatedTitle?: string; summary?: string; firstPrompt?: string; cwd?: string; lastModified?: number }>).map(async (session) => {
      if (!session.sessionId) return
      const dbEntry = (dbSessions || []).find(s => s.sessionId === session.sessionId)
      await upsertIndexedSession(session.sessionId!, {
        provider: 'claude',
        title: dbEntry?.name || session.generatedTitle || session.summary || undefined,
        firstPrompt: (dbEntry?.firstPrompt || session.firstPrompt || '').trim() || null,
        workspaceDir: session.cwd || null,
        updatedAt: typeof session.lastModified === 'number' ? session.lastModified : null,
      })
    }),
  )

  // Upsert Codex Desktop threads so they appear in the sidebar
  await Promise.all(
    codexThreads.map(async (thread) => {
      await upsertIndexedSession(thread.id, {
        provider: 'codex',
        title: thread.title || null,
        firstPrompt: thread.firstUserMessage || null,
        workspaceDir: thread.cwd || null,
        updatedAt: thread.updatedAt,
      })
    }),
  )

  const refreshedIndexed = await listIndexedSessions()
  const result = buildSessionList({
    indexedSessions: refreshedIndexed,
    claudeSessions: sdkSessions as SessionInfo[],
    claudeDbSessions: dbSessions || [],
  })

  // Backfill: generate haiku only for sessions with no title from ANY source.
  // Sessions with provider-native titles (generatedTitle/summary) are skipped.
  const sdkMap = new Map(
    (sdkSessions as Array<{ sessionId?: string; generatedTitle?: string; summary?: string }>)
      .filter(s => s.sessionId)
      .map(s => [s.sessionId!, s]),
  )
  for (const indexed of refreshedIndexed) {
    if (indexed.title) continue
    if (indexed.provider !== 'claude') continue
    if (!indexed.firstPrompt) continue
    const sdk = sdkMap.get(indexed.sessionId)
    if (sdk?.generatedTitle || sdk?.summary) continue
    storeSessionTitle(indexed.sessionId, indexed.firstPrompt)
  }

  return {
    sessions: result.sessions,
    titlesLoaded: dbFetchSucceeded || result.titlesLoaded,
  }
}

function stripPromptContext(prompt: string): string {
  // Remove injected XML blocks from prompt-preprocessor before using for title generation
  return prompt
    .replace(/<codebase_context>[\s\S]*?<\/codebase_context>\s*/g, '')
    .replace(/<file_context>[\s\S]*?<\/file_context>\s*/g, '')
    .replace(/<documentation_context>[\s\S]*?<\/documentation_context>\s*/g, '')
    .trim()
}

/** Generate title text only — no storage. Can be started before session ID is known. */
export function beginTitleGeneration(prompt: string): Promise<string> {
  const cleanPrompt = stripPromptContext(prompt.trim())
  if (!cleanPrompt) return Promise.resolve('')
  return (async () => {
    try {
      const cliPath = getCliPath()
      const titleQuery = query({
        prompt: `Respond with ONLY a 3-6 word title in proper case summarizing this message. No quotes, no punctuation at end, no extra text.\n\nMessage: ${cleanPrompt.slice(0, 200)}`,
        options: {
          model: 'claude-haiku-4-5-20251001',
          maxTurns: 1,
          persistSession: false,
          includePartialMessages: true,
          ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
        },
      })
      let streamTitle = ''
      try {
        for await (const message of titleQuery) {
          const msg = message as Record<string, unknown>
          if (msg.type === 'stream_event') {
            const evt = msg as { event?: { type?: string; delta?: { type?: string; text?: string } } }
            if (evt.event?.type === 'content_block_delta' && evt.event.delta?.type === 'text_delta' && evt.event.delta.text) {
              streamTitle += evt.event.delta.text
            }
          }
          // Skip 'assistant' messages — the final assistant message contains
          // the full text that was already accumulated via stream deltas above.
        }
      } finally { titleQuery.close() }
      return streamTitle.trim()
    } catch { return '' }
  })()
}

/** Store a title for a session (index + relay DB) and broadcast refresh. */
async function storeTitleForSession(sessionId: string, title: string): Promise<void> {
  if (!title || !moduleRelayClient || !moduleBroadcaster) return

  await upsertIndexedSession(sessionId, { provider: 'claude', title })

  const baseUrl = moduleRelayClient.getApiBaseUrl()
  if (baseUrl) {
    try {
      const token = await moduleRelayClient.getAuthToken()
      const resp = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: title }),
      })
      if (resp.status === 401) authFailureHandler?.()
    } catch { /* relay PUT failed — title still in local index */ }
  }

  moduleBroadcaster.send('sessions:refresh-hint')
}

/** Attach an already-started title generation to a session ID. Called when session ID is captured. */
export function completeTitleGeneration(sessionId: string, titlePromise: Promise<string>): void {
  if (titleGenerationBySession.has(sessionId)) return
  const wrapped = titlePromise.then(title => storeTitleForSession(sessionId, title))
  titleGenerationBySession.set(sessionId, wrapped)
}

/** Generate + store title for a session (backfill path). */
export function storeSessionTitle(sessionId: string, firstPrompt: string): void {
  const trimmed = firstPrompt.trim()
  if (!trimmed || titleGenerationBySession.has(sessionId)) return
  const generation = beginTitleGeneration(trimmed).then(title => storeTitleForSession(sessionId, title))
  titleGenerationBySession.set(sessionId, generation)
}

export async function getSessionMessagesData(sessionId: string, dir?: string) {
  const indexedMeta = await getIndexedSessionMeta(sessionId)
  const expectedProvider = indexedMeta?.provider

  // --- Codex sessions ---
  if (expectedProvider === 'codex') {
    // Check our own index first (codr-initiated sessions store messages here)
    const indexed = await getIndexedSessionMessages(sessionId)
    if (shouldUseIndexedMessages(indexed, 'codex')) {
      return indexed.rawMessages as Awaited<ReturnType<typeof getSessionMessages>>
    }
    // Fall back to Codex Desktop rollout file
    const rolloutPath = getCodexThreadRolloutPath(sessionId)
    if (rolloutPath && existsSync(rolloutPath)) {
      const messages = await parseCodexRollout(rolloutPath, sessionId)
      return messages as unknown as Awaited<ReturnType<typeof getSessionMessages>>
    }
    // Session exists but has no messages yet (just created)
    return [] as unknown as Awaited<ReturnType<typeof getSessionMessages>>
  }

  // --- Claude sessions: check index first, fall back to SDK ---
  const indexed = await getIndexedSessionMessages(sessionId)
  if (expectedProvider && shouldUseIndexedMessages(indexed, expectedProvider)) {
    return indexed.rawMessages as Awaited<ReturnType<typeof getSessionMessages>>
  }

  const messages = await getSessionMessages(sessionId, {
    ...(dir ? { dir } : {}),
  })
  await putIndexedRawMessages(sessionId, 'claude', messages as unknown[])
  return messages
}

export async function getAccountInfoData() {
  const provider = await getSelectedProvider()
  if (provider === 'codex') {
    return { tokenSource: 'openai-codex' } as AccountInfo
  }

  if (cachedAccountInfo) return cachedAccountInfo

  let probeQuery: ReturnType<typeof query> | null = null
  try {
    console.log('[account-info] Starting probe query...')
    const cliPath = getCliPath()
    probeQuery = query({
      // eslint-disable-next-line require-yield
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
  const provider = await getSelectedProvider()
  if (provider === 'codex') {
    return {
      status: 'ready',
      accountInfo: { tokenSource: 'openai-codex' } as AccountInfo,
    }
  }

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
      execSync(process.platform === 'win32' ? 'where claude' : 'which claude', { stdio: 'pipe', timeout: 5000 })
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
      // eslint-disable-next-line require-yield
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

export async function listFilesData(dir?: string, maxFiles?: number) {
  const root = dir || process.cwd()
  const { resolveFilesConfig } = await import('./runtime/files-config')
  const config = await resolveFilesConfig(root)
  const results: string[] = []
  const MAX_FILES = maxFiles ?? 10_000
  const ig = await loadIgnoreRules(root, config)

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
      const rel = relative(root, join(current, entry.name))
      if (entry.isDirectory()) {
        if (ig.ignores(rel + '/')) continue
        await walk(join(current, entry.name))
      } else {
        if (ig.ignores(rel)) continue
        results.push(rel.replaceAll('\\', '/'))
      }
    }
  }

  await walk(root)
  return results.sort()
}

// --- Provider status (independent check for both Claude and Codex) ---

export interface ProviderStatusInfo {
  installed: boolean
  loggedIn: boolean
  detail?: string
  email?: string
  org?: string
}

export interface AllProviderStatus {
  claude: ProviderStatusInfo
  codex: ProviderStatusInfo
}

function normalizeOrg(raw?: string): string {
  if (!raw || raw.endsWith('\u2019s Organization') || raw.endsWith("'s Organization")) return 'Personal'
  return raw
}

export async function getProviderStatusData(): Promise<AllProviderStatus> {
  const [claudeStatus, codexStatus] = await Promise.all([
    (async (): Promise<ProviderStatusInfo> => {
      const cliPath = getCliPath()
      let installed = false
      try {
        if (cliPath) {
          installed = existsSync(cliPath)
        } else {
          execSync(process.platform === 'win32' ? 'where claude' : 'which claude', { stdio: 'pipe', timeout: 3000 })
          installed = true
        }
      } catch {
        installed = false
      }
      if (!installed) return { installed: false, loggedIn: false }

      if (cachedAccountInfo) {
        const detail = cachedAccountInfo.subscriptionType || cachedAccountInfo.apiKeySource
        return {
          installed: true, loggedIn: true, detail: detail || undefined,
          email: cachedAccountInfo.email,
          org: normalizeOrg(cachedAccountInfo.organization),
        }
      }

      let probeQuery: ReturnType<typeof query> | null = null
      try {
        probeQuery = query({
          // eslint-disable-next-line require-yield
          prompt: (async function* () { await new Promise(() => {}) })(),
          options: {
            persistSession: false,
            ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
          },
        })
        const info = await Promise.race([
          probeQuery.accountInfo(),
          new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8_000)),
        ])
        if (info) {
          cachedAccountInfo = info
          const detail = info.subscriptionType || info.apiKeySource
          return {
            installed: true, loggedIn: true, detail: detail || undefined,
            email: info.email,
            org: normalizeOrg(info.organization),
          }
        }
        return { installed: true, loggedIn: false }
      } catch {
        return { installed: true, loggedIn: false }
      } finally {
        probeQuery?.close()
      }
    })(),

    (async (): Promise<ProviderStatusInfo> => {
      const codexHome = join(homedir(), '.codex')
      const installed = existsSync(codexHome)
      if (!installed) return { installed: false, loggedIn: false }

      // Determine auth method and base status
      const sqliteDb = join(codexHome, 'state_5.sqlite')
      const authJsonPath = join(codexHome, 'auth.json')
      let loggedIn = false
      let baseDetail: string | undefined

      if (existsSync(sqliteDb) || existsSync(authJsonPath)) {
        loggedIn = true
      } else if (process.env.OPENAI_API_KEY) {
        loggedIn = true
        baseDetail = 'API Key'
      } else {
        const configPaths = [join(codexHome, 'config.json'), join(codexHome, '.config.json')]
        for (const cfgPath of configPaths) {
          if (existsSync(cfgPath)) {
            try {
              const { readFileSync } = await import('node:fs')
              const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8')) as Record<string, unknown>
              if (cfg.api_key || cfg.apiKey || cfg.openai_api_key) {
                loggedIn = true
                baseDetail = 'API Key'
                break
              }
            } catch { /* ignore */ }
          }
        }
      }

      if (!loggedIn) return { installed: true, loggedIn: false }

      // Try to fetch rich account info from auth.json + OpenAI API
      try {
        if (existsSync(authJsonPath)) {
          const { readFileSync } = await import('node:fs')
          const authData = JSON.parse(readFileSync(authJsonPath, 'utf-8')) as {
            tokens?: { access_token?: string; id_token?: string }
          }
          const accessToken = authData.tokens?.access_token
          const idToken = authData.tokens?.id_token

          let planType: string | undefined
          // Decode JWT id_token payload for plan type
          if (idToken) {
            try {
              const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString())
              const authClaim = payload['https://api.openai.com/auth'] as Record<string, unknown> | undefined
              if (authClaim?.chatgpt_plan_type) {
                planType = String(authClaim.chatgpt_plan_type)
                planType = planType.charAt(0).toUpperCase() + planType.slice(1)
              }
            } catch { /* JWT decode failed */ }
          }

          // Fetch email/org from /v1/me
          if (accessToken) {
            const ctrl = new AbortController()
            const timer = setTimeout(() => ctrl.abort(), 5_000)
            try {
              const resp = await fetch('https://api.openai.com/v1/me', {
                headers: { Authorization: `Bearer ${accessToken}` },
                signal: ctrl.signal,
              })
              if (resp.ok) {
                const me = await resp.json() as {
                  email?: string
                  orgs?: { data?: Array<{ personal?: boolean; title?: string }> }
                }
                // Find org name: use first real org, or "Personal"
                const orgs = me.orgs?.data || []
                const namedOrg = orgs.find(o => !o.personal && normalizeOrg(o.title) !== 'Personal')
                const orgLabel = namedOrg?.title || 'Personal'
                return {
                  installed: true,
                  loggedIn: true,
                  detail: planType || baseDetail,
                  email: me.email,
                  org: orgLabel,
                }
              }
            } catch { /* API call failed — fall through */ }
            finally { clearTimeout(timer) }
          }

          // Had auth.json but API call failed — still use plan from JWT
          if (planType) {
            return { installed: true, loggedIn: true, detail: planType }
          }
        }
      } catch { /* auth.json read failed */ }

      return { installed: true, loggedIn: true, detail: baseDetail }
    })(),
  ])

  return { claude: claudeStatus, codex: codexStatus }
}

// --- IPC handlers ---

export function registerSessionHandlers(relayClient?: RelayClient, broadcaster?: EventBroadcaster, getAuthToken?: () => Promise<string>) {
  moduleRelayClient = relayClient
  moduleBroadcaster = broadcaster

  ipcMain.handle('sessions:list', async () => {
    return listSessionsData(relayClient, getAuthToken)
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

  ipcMain.handle('providers:get-status', async () => {
    return getProviderStatusData()
  })

  ipcMain.handle('sessions:list-files', async (_event, dir?: string) => {
    return listFilesData(dir)
  })

  ipcMain.handle('files-config:get-global', async () => {
    const { getGlobalFilesConfig } = await import('./runtime/files-config')
    return getGlobalFilesConfig()
  })

  ipcMain.handle('files-config:set-global', async (_event, cfg: import('./runtime/files-config').GlobalFilesConfigFile) => {
    const { setGlobalFilesConfig } = await import('./runtime/files-config')
    await setGlobalFilesConfig(cfg)
    return { ok: true }
  })

  ipcMain.handle('files-config:get-project', async (_event, projectDir: string) => {
    const { getProjectFilesConfig } = await import('./runtime/files-config')
    return getProjectFilesConfig(projectDir)
  })

  ipcMain.handle('files-config:set-project', async (_event, projectDir: string, cfg: import('./runtime/files-config').ProjectFilesConfigFile) => {
    const { setProjectFilesConfig } = await import('./runtime/files-config')
    await setProjectFilesConfig(projectDir, cfg)
    return { ok: true }
  })

  ipcMain.handle('files-config:get-computed', async (_event, projectDir: string) => {
    const { computeTaggedIgnoreEntries } = await import('./runtime/files-config')
    return computeTaggedIgnoreEntries(projectDir)
  })

  ipcMain.handle('sessions:regen-title', async (_event, sessionId: string, firstPrompt: string) => {
    if (!firstPrompt?.trim()) return
    await upsertIndexedSession(sessionId, { provider: 'claude', title: null })
    titleGenerationBySession.delete(sessionId)
    const title = await beginTitleGeneration(firstPrompt.trim())
    await storeTitleForSession(sessionId, title)
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
