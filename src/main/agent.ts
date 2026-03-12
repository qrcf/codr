import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import { app, ipcMain, type BrowserWindow } from 'electron'
import path from 'node:path'
import { createCanUseTool, registerPermissionHandlers, type MessageOrigin } from './permissions'
import type { EventBroadcaster } from './event-broadcaster'
import type { RelayClient } from './relay-client'
import { storeSessionMetadata, setCachedAccountInfo } from './sessions'

/**
 * In packaged builds the SDK can't resolve cli.js via import.meta.url because
 * the module lives inside app.asar. Return the unpacked path instead.
 */
export function getCliPath(): string | undefined {
  if (!app.isPackaged) return undefined
  return path.join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '@anthropic-ai',
    'claude-agent-sdk',
    'cli.js'
  )
}

interface DocSearchResult {
  sourceName: string
  sourceUrl: string
  pageUrl: string
  pageTitle: string | null
  heading: string | null
  content: string
}

/**
 * Parse @docs:SourceName references from a prompt.
 * Returns the cleaned prompt (without @docs tokens) and the doc source names.
 */
function parseDocRefs(prompt: string): { cleanedPrompt: string; docNames: string[] } {
  const docNames: string[] = []
  const cleaned = prompt.replace(/@docs:(\S+)/g, (_, name) => {
    docNames.push(name)
    return ''
  }).trim()
  return { cleanedPrompt: cleaned, docNames }
}

/**
 * Retrieve documentation context from the relay server's search endpoint.
 */
async function retrieveDocsContext(
  relayClient: RelayClient,
  searchQuery: string,
  docNames: string[],
): Promise<string> {
  const httpBaseUrl = relayClient.getHttpBaseUrl()
  const token = relayClient.getClerkToken()
  if (!httpBaseUrl || !token) return ''

  try {
    const res = await fetch(`${httpBaseUrl}/api/docs/search`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: searchQuery,
        // We don't filter by sourceIds here since we'd need to resolve names to IDs.
        // The search already filters to the user's sources.
        limit: 8,
      }),
    })

    if (!res.ok) return ''

    const results = await res.json() as DocSearchResult[]
    if (!results.length) return ''

    // If docNames were specified, filter to only matching sources
    const filtered = docNames.length > 0
      ? results.filter(r => docNames.some(name =>
          r.sourceName.toLowerCase() === name.toLowerCase()
        ))
      : results

    if (!filtered.length) return ''

    const chunks = filtered.map(r => {
      const source = `${r.sourceName} (${r.pageUrl})`
      const heading = r.heading ? `## ${r.heading}\n` : ''
      return `--- ${source} ---\n${heading}${r.content}`
    }).join('\n\n')

    return `<documentation_context>\n${chunks}\n</documentation_context>`
  } catch (err) {
    console.error('[docs] Failed to retrieve docs context:', err)
    return ''
  }
}

// Track multiple concurrent queries keyed by session ID (or temp key for new sessions)
const activeQueries = new Map<string, Query>()

export function registerAgentHandlers(
  getMainWindow: () => BrowserWindow | null,
  broadcaster: EventBroadcaster,
  relayClient: RelayClient,
) {
  registerPermissionHandlers(broadcaster)

  // Run a query (used by both IPC and relay-forwarded commands)
  async function runQuery(prompt: string, resumeSessionId?: string, planMode?: boolean, cwd?: string, askMode?: boolean, origin: MessageOrigin = 'local') {
    // Generate a unique key for this query (real session ID for resumes, temp key for new)
    let currentKey = resumeSessionId || `new-${Date.now()}-${Math.random().toString(36).slice(2)}`

    broadcaster.markQueryStart(currentKey, prompt)
    const isNewSession = !resumeSessionId
    let capturedSessionId: string | null = resumeSessionId || null

    const stderrChunks: string[] = []

    // Create a per-query canUseTool that knows its session ID and origin
    const canUseTool = createCanUseTool(broadcaster, () => currentKey, askMode, origin)

    // In ask mode, prepend instruction telling the AI to only answer questions
    let finalPrompt = askMode
      ? `[ASK MODE] You are in Ask mode. Your job is to ANSWER the user's question — do NOT edit any code, create files, or make changes. Only read, search, and explain. Do not use Edit, Write, or NotebookEdit tools.\n\n${prompt}`
      : prompt

    // Handle @docs:SourceName references — retrieve and inject doc context
    const { cleanedPrompt, docNames } = parseDocRefs(finalPrompt)
    if (docNames.length > 0) {
      const docsContext = await retrieveDocsContext(relayClient, cleanedPrompt, docNames)
      if (docsContext) {
        finalPrompt = `${docsContext}\n\n${cleanedPrompt}`
      } else {
        finalPrompt = cleanedPrompt
      }
    }

    const cliPath = getCliPath()
    const q = query({
      prompt: finalPrompt,
      options: {
        includePartialMessages: true,
        canUseTool,
        stderr: (data) => stderrChunks.push(data),
        ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
        ...(resumeSessionId ? { resume: resumeSessionId } : {}),
        ...(planMode ? { permissionMode: 'plan' as const } : {}),
        ...(cwd ? { cwd } : {}),
      },
    })

    activeQueries.set(currentKey, q)

    // Opportunistically grab account info from this real query (fallback for
    // when the probe query fails in packaged builds). Fire-and-forget.
    q.accountInfo?.().then((info) => {
      if (info) {
        setCachedAccountInfo(info)
        const win = getMainWindow()
        if (win && !win.isDestroyed()) {
          win.webContents.send('sessions:account-info-update', info)
        }
      }
    }).catch(() => {})

    try {
      for await (const message of q) {
        if (!capturedSessionId && (message as { session_id?: string }).session_id) {
          capturedSessionId = (message as { session_id?: string }).session_id!
          // Re-key from temp key to real session ID
          activeQueries.delete(currentKey)
          broadcaster.updateQuerySessionId(currentKey, capturedSessionId)
          currentKey = capturedSessionId
          activeQueries.set(currentKey, q)

          if (isNewSession) {
            broadcaster.send('sessions:refresh-hint')
            storeSessionMetadata(capturedSessionId, prompt, relayClient, broadcaster).catch(() => {})
          }
        }
        broadcaster.send('agent:message', message, currentKey)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const stderr = stderrChunks.join('').trim().slice(-500)
      const errorText = stderr ? `${message}\n\n${stderr}` : message
      broadcaster.send('agent:error', errorText, currentKey)
    } finally {
      activeQueries.delete(currentKey)
      broadcaster.send('agent:done', undefined, currentKey)
      broadcaster.send('sessions:refresh-hint')
    }
  }

  async function interruptQuery(sessionId?: string) {
    if (sessionId) {
      // Interrupt a specific session's query
      const q = activeQueries.get(sessionId)
      if (q) {
        await q.interrupt()
      }
    } else {
      // Interrupt all active queries
      for (const q of activeQueries.values()) {
        await q.interrupt()
      }
    }
  }

  // IPC handlers (Electron renderer)
  ipcMain.handle('agent:query', async (_event, prompt: string, opts?: { resumeSessionId?: string; planMode?: boolean; cwd?: string; askMode?: boolean }) => {
    const win = getMainWindow()
    if (!win) return
    await runQuery(prompt, opts?.resumeSessionId, opts?.planMode, opts?.cwd, opts?.askMode)
  })

  ipcMain.handle('agent:interrupt', async (_event, sessionId?: string) => {
    await interruptQuery(sessionId)
  })

  // Return functions for relay-forwarded commands
  return { runQuery, interruptQuery } as const
}
