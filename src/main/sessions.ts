import { query } from '@anthropic-ai/claude-agent-sdk'
import type { AccountInfo } from '@anthropic-ai/claude-agent-sdk'
import type { SessionInfo } from '@codr-works/types'
import { dialog, ipcMain } from 'electron'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import ignore from 'ignore'
import { getCliPath } from './agent'
import type { RelayClient } from './relay-client'
import type { EventBroadcaster } from './event-broadcaster'
import type { AgentProviderId } from './runtime/provider'
import { PROVIDER_IDS } from './runtime/provider'
import { getSelectedProvider } from './runtime/provider-config'
import { getIndexedSessionMessages, getIndexedSessionMeta, listIndexedSessions, putIndexedRawMessages, upsertIndexedSession, getPersistedProviderStatus, persistProviderStatus } from './runtime/session-index'
import { buildSessionList, shouldUseIndexedMessages, type ClaudeDbSessionMeta } from './runtime/session-records'
import type { ProviderSessionDiscovery, DiscoveryContext } from './runtime/provider-discovery'
import { ClaudeSessionDiscovery, setCachedAccountInfo as setClaudeCachedAccountInfo, getCachedAccountInfo } from './runtime/providers/claude/discovery'
import { AcpSessionDiscovery } from './runtime/acp/discovery'
import { isAcpSessionFormat, parseAcpSession } from './runtime/acp/session-parser'
import { createCursorConfig } from './runtime/acp/configs/cursor'
import { getAllCapabilities, setBroadcastCapabilityChange } from './runtime/provider-capabilities'

// Re-export ProviderStatusInfo for consumers
export type { ProviderStatusInfo } from './runtime/provider-discovery'

// --- Discovery registry ---

const discoveries: ProviderSessionDiscovery[] = [
  new ClaudeSessionDiscovery(),
  new AcpSessionDiscovery(createCursorConfig()),
]

function getDiscovery(providerId: AgentProviderId): ProviderSessionDiscovery | undefined {
  return discoveries.find(d => d.providerId === providerId)
}

// --- Session watcher: detects external changes (e.g., Claude Desktop, Codex Desktop) ---

export function startSessionWatcher(broadcaster: EventBroadcaster): ReturnType<typeof setInterval> {
  return setInterval(async () => {
    if (broadcaster.hasActiveQueries()) return
    try {
      const results = await Promise.all(discoveries.map(d => d.checkForChanges()))
      if (results.some(changed => changed)) {
        broadcaster.send('sessions:refresh-hint')
      }
    } catch {
      // Silent failure — SDK may not be ready yet
    }
  }, 5_000)
}

/** Allow agent.ts to update the cached account info (fallback from real queries). */
export function setCachedAccountInfo(info: AccountInfo | null) {
  setClaudeCachedAccountInfo(info)
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

/** Full discovery + upsert cycle. Returns the updated indexed sessions. */
async function runDiscovery(context: DiscoveryContext): Promise<{
  allDiscovered: import('./runtime/provider-discovery').DiscoveredSession[][]
  refreshedIndexed: import('./runtime/session-index').IndexedSessionMeta[]
}> {
  const allDiscovered = await Promise.all(
    discoveries.map(d => d.discoverSessions(context).catch(() => []))
  )

  await Promise.all(
    allDiscovered.flat().map(async (session) => {
      await upsertIndexedSession(session.sessionId, {
        provider: session.provider,
        title: session.title || undefined,
        firstPrompt: session.firstPrompt || null,
        workspaceDir: session.workspaceDir || null,
        updatedAt: session.updatedAt || null,
      })
    }),
  )

  const refreshedIndexed = await listIndexedSessions()
  return { allDiscovered, refreshedIndexed }
}

let pendingDiscoveryPromise: Promise<void> | null = null

/** Kick off discovery in the background; broadcast refresh-hint if the session set changes. */
function discoverInBackground(context: DiscoveryContext, prevSessionIds: Set<string>): void {
  if (pendingDiscoveryPromise) return
  pendingDiscoveryPromise = (async () => {
    try {
      const { refreshedIndexed } = await runDiscovery(context)
      const newIds = new Set(refreshedIndexed.map(s => s.sessionId))
      const changed =
        newIds.size !== prevSessionIds.size ||
        refreshedIndexed.some(s => !prevSessionIds.has(s.sessionId))
      if (changed) {
        moduleBroadcaster?.send('sessions:refresh-hint')
      }
    } catch { /* silent — background work */ }
  })().finally(() => {
    pendingDiscoveryPromise = null
  })
}

export async function listSessionsData(relayClient?: RelayClient, getAuthToken?: () => Promise<string>) {
  const context: DiscoveryContext = {
    relayClient: relayClient ? {
      getApiBaseUrl: () => relayClient.getApiBaseUrl(),
      getAuthToken: () => relayClient.getAuthToken(),
    } : undefined,
    getAuthToken,
  }

  // If we have sessions in the index already, return them immediately and discover in background
  const existingIndexed = await listIndexedSessions()
  if (existingIndexed.length > 0) {
    const claudeDbSessions = await fetchClaudeDbSessions(relayClient, getAuthToken)
    const dbFetchSucceeded = claudeDbSessions !== null

    const result = buildSessionList({
      indexedSessions: existingIndexed,
      claudeSessions: [],
      claudeDbSessions: claudeDbSessions || [],
    })

    // Backfill titles for indexed sessions without one
    for (const indexed of existingIndexed) {
      if (indexed.title) continue
      if (!indexed.firstPrompt) continue
      storeSessionTitle(indexed.sessionId, indexed.firstPrompt)
    }

    const prevIds = new Set(existingIndexed.map(s => s.sessionId))
    discoverInBackground(context, prevIds)

    return {
      sessions: result.sessions,
      titlesLoaded: dbFetchSucceeded || result.titlesLoaded,
    }
  }

  // First run — no index yet, do blocking discovery
  const { allDiscovered, refreshedIndexed } = await runDiscovery(context)

  const claudeIdx = discoveries.findIndex(d => d.providerId === 'claude')
  const claudeDiscovered = claudeIdx >= 0 ? allDiscovered[claudeIdx] : []
  const claudeDbSessions = await fetchClaudeDbSessions(relayClient, getAuthToken)
  const dbFetchSucceeded = claudeDbSessions !== null

  const result = buildSessionList({
    indexedSessions: refreshedIndexed,
    claudeSessions: claudeDiscovered.map((s): SessionInfo => ({
      sessionId: s.sessionId,
      summary: '',
      lastModified: s.updatedAt || 0,
      fileSize: 0,
      generatedTitle: s.title || undefined,
      firstPrompt: s.firstPrompt || undefined,
      cwd: s.workspaceDir || undefined,
    })),
    claudeDbSessions: claudeDbSessions || [],
  })

  // Backfill: generate haiku titles for sessions with no title from ANY source
  const sdkMap = new Map(
    claudeDiscovered.filter(s => s.sessionId).map(s => [s.sessionId, s]),
  )
  for (const indexed of refreshedIndexed) {
    if (indexed.title) continue
    if (!indexed.firstPrompt) continue
    const sdk = sdkMap.get(indexed.sessionId)
    if (sdk?.title) continue
    storeSessionTitle(indexed.sessionId, indexed.firstPrompt)
  }

  return {
    sessions: result.sessions,
    titlesLoaded: dbFetchSucceeded || result.titlesLoaded,
  }
}

/** Fetch Claude DB sessions for title cross-referencing. */
async function fetchClaudeDbSessions(relayClient?: RelayClient, getAuthToken?: () => Promise<string>): Promise<ClaudeDbSessionMeta[] | null> {
  const baseUrl = relayClient?.getApiBaseUrl()
  if (!baseUrl) return null
  try {
    const token = getAuthToken ? await getAuthToken() : relayClient!.getAuthToken()
    const resp = await fetch(`${baseUrl}/api/sessions`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (resp.ok) return (await resp.json()) as ClaudeDbSessionMeta[]
    if (resp.status === 401) authFailureHandler?.()
  } catch { /* empty */ }
  return null
}

function stripPromptContext(prompt: string): string {
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
        }
      } finally { titleQuery.close() }
      return streamTitle.trim()
    } catch { return '' }
  })()
}

/** Store a title for a session (index + relay DB) and broadcast refresh. */
async function storeTitleForSession(sessionId: string, title: string): Promise<void> {
  if (!title || !moduleRelayClient || !moduleBroadcaster) return

  // Look up the session's actual provider rather than hardcoding 'claude'
  const meta = await getIndexedSessionMeta(sessionId)
  await upsertIndexedSession(sessionId, { provider: meta?.provider || 'claude', title })

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

  // Check our index first for any provider
  const indexed = await getIndexedSessionMessages(sessionId)
  if (expectedProvider && shouldUseIndexedMessages(indexed, expectedProvider)) {
    // ACP sessions are stored as raw SessionUpdate events — convert to message format
    if (isAcpSessionFormat(indexed.rawMessages)) {
      return parseAcpSession(sessionId, expectedProvider, indexed.rawMessages)
    }
    return indexed.rawMessages
  }

  // Delegate to provider-specific discovery for external message sources
  if (expectedProvider) {
    const discovery = getDiscovery(expectedProvider)
    if (discovery) {
      const messages = await discovery.getSessionMessages(sessionId, dir)
      if (messages && messages.length > 0) {
        await putIndexedRawMessages(sessionId, expectedProvider, messages)
        return messages
      }
    }
  }

  // Session exists but has no messages yet
  return []
}

export async function getAccountInfoData() {
  const provider = await getSelectedProvider()
  const discovery = getDiscovery(provider)
  if (discovery) {
    return discovery.getAccountInfo()
  }
  return null
}

export type CliStatus =
  | { status: 'ready'; accountInfo: AccountInfo }
  | { status: 'not-installed' }
  | { status: 'not-logged-in' }
  | { status: 'error'; message: string }

export async function checkCliStatus(): Promise<CliStatus> {
  const provider = await getSelectedProvider()

  // Non-Claude providers: check via discovery status
  if (provider !== 'claude') {
    const discovery = getDiscovery(provider)
    if (discovery) {
      const status = await discovery.checkStatus()
      if (status.installed && status.loggedIn) {
        const accountInfo = await discovery.getAccountInfo()
        return { status: 'ready', accountInfo: accountInfo as AccountInfo }
      }
      return status.installed ? { status: 'not-logged-in' } : { status: 'not-installed' }
    }
    return { status: 'not-installed' }
  }

  // Claude: use cached info or probe
  const cachedAccountInfo = getCachedAccountInfo()
  if (cachedAccountInfo) {
    return { status: 'ready', accountInfo: cachedAccountInfo }
  }

  // Stage 1: Check if claude binary exists
  const cliPath = getCliPath()
  try {
    if (cliPath) {
      if (!existsSync(cliPath)) {
        return { status: 'not-installed' }
      }
    } else {
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
      setClaudeCachedAccountInfo(info)
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

// --- Provider status ---

export type AllProviderStatus = Record<AgentProviderId, import('./runtime/provider-discovery').ProviderStatusInfo>

let pendingStatusPromise: Promise<AllProviderStatus> | null = null

async function doProviderStatusCheck(): Promise<AllProviderStatus> {
  const results = await Promise.all(
    PROVIDER_IDS.map(async (id) => {
      const discovery = getDiscovery(id)
      if (!discovery) return [id, { installed: false, loggedIn: false }] as const
      const status = await discovery.checkStatus()
      return [id, status] as const
    })
  )
  const status = Object.fromEntries(results) as AllProviderStatus
  // Persist for next boot
  for (const [id, info] of Object.entries(status)) {
    persistProviderStatus(id, info)
  }
  return status
}

function refreshProviderStatusInBackground(): void {
  if (pendingStatusPromise) return
  pendingStatusPromise = doProviderStatusCheck().finally(() => {
    pendingStatusPromise = null
  })
  pendingStatusPromise.then((fresh) => {
    // Broadcast to renderer if status has changed
    moduleBroadcaster?.send('providers:status-changed', fresh)
  }).catch(() => {})
}

export async function getProviderStatusData(): Promise<AllProviderStatus> {
  // Return persisted status immediately on boot; refresh in background
  const persisted = getPersistedProviderStatus()
  if (persisted && Object.keys(persisted).length > 0) {
    refreshProviderStatusInBackground()
    return persisted as AllProviderStatus
  }

  // First-ever run or no cache — do a blocking check
  if (pendingStatusPromise) return pendingStatusPromise
  pendingStatusPromise = doProviderStatusCheck().finally(() => {
    pendingStatusPromise = null
  })
  return pendingStatusPromise
}

// --- IPC handlers ---

export function registerSessionHandlers(relayClient?: RelayClient, broadcaster?: EventBroadcaster, getAuthToken?: () => Promise<string>) {
  moduleRelayClient = relayClient
  moduleBroadcaster = broadcaster

  // Wire up capability change broadcasts to renderer
  setBroadcastCapabilityChange((providerId, capabilities) => {
    broadcaster?.send('providers:capabilities-changed', { providerId, capabilities })
  })

  ipcMain.handle('sessions:list', async () => {
    return listSessionsData(relayClient, getAuthToken)
  })

  ipcMain.handle('sessions:get-messages', async (_event, sessionId: string, dir?: string) => {
    return getSessionMessagesData(sessionId, dir)
  })

  ipcMain.handle('sessions:get-raw-messages', async (_event, sessionId: string) => {
    const indexed = await getIndexedSessionMessages(sessionId)
    return indexed?.rawMessages ?? []
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

  ipcMain.handle('providers:get-capabilities', async () => {
    return getAllCapabilities()
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
    const meta = await getIndexedSessionMeta(sessionId)
    await upsertIndexedSession(sessionId, { provider: meta?.provider || 'claude', title: null })
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
      const sshMatch = url.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/)
      if (sshMatch) return '@' + sshMatch[1]
      try {
        const parsed = new URL(url)
        const parts = parsed.pathname.replace(/\.git$/, '').split('/').filter(Boolean)
        if (parts.length >= 2) return '@' + parts.slice(-2).join('/')
      } catch { /* not a valid URL, fall through */ }
    } catch { /* not a git repo or no remote */ }
    return basename(folderPath)
  })
}
