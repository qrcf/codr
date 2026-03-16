import { listSessions, getSessionMessages, query } from '@anthropic-ai/claude-agent-sdk'
import type { AccountInfo } from '@anthropic-ai/claude-agent-sdk'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { stat as fsStat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { getCliPath } from '../../../agent'
import type { ProviderSessionDiscovery, DiscoveredSession, ProviderStatusInfo, DiscoveryContext } from '../../provider-discovery'
import type { ClaudeDbSessionMeta } from '../../session-records'

let cachedAccountInfo: AccountInfo | null = null

export function getCachedAccountInfo(): AccountInfo | null {
  return cachedAccountInfo
}

export function setCachedAccountInfo(info: AccountInfo | null): void {
  if (info) cachedAccountInfo = info
}

function normalizeOrg(raw?: string): string {
  if (!raw || raw.endsWith('\u2019s Organization') || raw.endsWith("'s Organization")) return 'Personal'
  return raw
}

export class ClaudeSessionDiscovery implements ProviderSessionDiscovery {
  readonly providerId = 'claude' as const
  private lastMtime = 0

  async discoverSessions(context: DiscoveryContext): Promise<DiscoveredSession[]> {
    const baseUrl = context.relayClient?.getApiBaseUrl()

    const [sdkSessions, dbSessions] = await Promise.all([
      listSessions({ limit: 50 }).catch(() => []),
      baseUrl
        ? (async () => {
            try {
              const token = context.getAuthToken ? await context.getAuthToken() : context.relayClient!.getAuthToken()
              const resp = await fetch(`${baseUrl}/api/sessions`, {
                headers: { Authorization: `Bearer ${token}` },
              })
              if (resp.ok) return (await resp.json()) as ClaudeDbSessionMeta[]
            } catch { /* empty */ }
            return null
          })()
        : Promise.resolve(null),
    ])

    const dbMap = new Map(
      (dbSessions || []).filter(s => s.sessionId).map(s => [s.sessionId, s]),
    )

    return (sdkSessions as Array<{
      sessionId?: string; generatedTitle?: string; summary?: string;
      firstPrompt?: string; cwd?: string; lastModified?: number
    }>)
      .filter(s => s.sessionId)
      .map(session => {
        const dbEntry = dbMap.get(session.sessionId!)
        return {
          sessionId: session.sessionId!,
          provider: 'claude' as const,
          title: dbEntry?.name || session.generatedTitle || session.summary || undefined,
          firstPrompt: (dbEntry?.firstPrompt || session.firstPrompt || '').trim() || null,
          workspaceDir: session.cwd || null,
          updatedAt: typeof session.lastModified === 'number' ? session.lastModified : null,
        }
      })
  }

  async getSessionMessages(sessionId: string, dir?: string): Promise<unknown[] | null> {
    try {
      const messages = await getSessionMessages(sessionId, {
        ...(dir ? { dir } : {}),
      })
      return messages as unknown[]
    } catch {
      return null
    }
  }

  async getAccountInfo(): Promise<AccountInfo | null> {
    if (cachedAccountInfo) return cachedAccountInfo

    let probeQuery: ReturnType<typeof query> | null = null
    try {
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

      cachedAccountInfo = await Promise.race([
        probeQuery.accountInfo(),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('accountInfo timed out after 10s')), 10_000)
        ),
      ])

      return cachedAccountInfo
    } catch {
      return null
    } finally {
      probeQuery?.close()
    }
  }

  async checkStatus(): Promise<ProviderStatusInfo> {
    const cliPath = getCliPath()
    let installed: boolean
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
  }

  async checkForChanges(): Promise<boolean> {
    const claudeProjectsDir = join(homedir(), '.claude', 'projects')
    const s = await fsStat(claudeProjectsDir).catch(() => null)
    if (!s) return false
    const mtime = s.mtimeMs
    if (this.lastMtime === 0) {
      this.lastMtime = mtime
      return false
    }
    if (mtime !== this.lastMtime) {
      this.lastMtime = mtime
      return true
    }
    return false
  }
}
