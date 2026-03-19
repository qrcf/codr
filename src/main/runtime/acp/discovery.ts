import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AgentProviderId } from '../../../shared/provider-types'
import type { ProviderSessionDiscovery, DiscoveredSession, ProviderStatusInfo, DiscoveryContext } from '../provider-discovery'
import type { AcpAgentConfig } from './agent-config'
import { getAcpProvider } from './registry'

const execFileAsync = promisify(execFile)

function buildCliEnv(config: AcpAgentConfig): NodeJS.ProcessEnv {
  return { ...process.env, ...config.env }
}

// Per-provider cached account info
const cachedAccountInfoMap = new Map<AgentProviderId, { email?: string } | null>()
const lastSessionCountMap = new Map<AgentProviderId, number>()

// Per-provider cached checkStatus results
const cachedStatusMap = new Map<AgentProviderId, { result: ProviderStatusInfo; ts: number }>()
const STATUS_TTL_MS = 60_000

export class AcpSessionDiscovery implements ProviderSessionDiscovery {
  readonly providerId: AgentProviderId
  private readonly config: AcpAgentConfig

  constructor(config: AcpAgentConfig) {
    this.providerId = config.providerId
    this.config = config
  }

  async discoverSessions(_context: DiscoveryContext): Promise<DiscoveredSession[]> {
    const provider = getAcpProvider(this.providerId)
    if (!provider) return []

    if (!provider.isAlive()) {
      try {
        await provider.connect()
      } catch {
        return [] // ACP agent not available
      }
    }
    if (!provider.supportsSessionList) {
      return []
    }

    try {
      const sessions: DiscoveredSession[] = []
      let cursor: string | undefined = undefined
      let pages = 0
      const MAX_PAGES = 10

      do {
        const result = await provider.acpListSessions({ cursor })
        for (const s of result.sessions) {
          sessions.push({
            sessionId: s.sessionId,
            provider: this.providerId,
            title: s.title || null,
            workspaceDir: s.cwd || null,
            updatedAt: s.updatedAt ? new Date(s.updatedAt).getTime() : null,
          })
        }
        cursor = result.nextCursor ?? undefined
        pages++
      } while (cursor && pages < MAX_PAGES)

      lastSessionCountMap.set(this.providerId, sessions.length)
      return sessions
    } catch (err) {
      console.error(`[${this.providerId}-discovery] Failed to list sessions:`, (err as Error).message)
      return []
    }
  }

  async getSessionMessages(sessionId: string, dir?: string): Promise<unknown[] | null> {
    const provider = getAcpProvider(this.providerId)
    if (!provider) return null

    if (!provider.isAlive()) {
      try {
        await provider.connect()
      } catch {
        return null
      }
    }

    try {
      // Collect raw ACP SessionUpdate events
      const updates: unknown[] = []
      const unsub = provider.onSessionUpdate((sid, update) => {
        if (sid === sessionId) {
          updates.push(update)
        }
      })

      // Load session — replays full history as session/update notifications
      await provider.acpLoadSession(sessionId, dir || process.cwd())

      unsub()
      return updates.length > 0 ? updates : null
    } catch (err) {
      console.error(`[${this.providerId}-discovery] Failed to load session messages:`, (err as Error).message)
      return null
    }
  }

  async getAccountInfo(): Promise<{ email?: string } | null> {
    const cached = cachedAccountInfoMap.get(this.providerId)
    if (cached) return cached

    try {
      const { stdout } = await execFileAsync(this.config.command, ['agent', 'status'], {
        env: buildCliEnv(this.config),
        timeout: 5000,
      })

      const emailPatterns = [
        /Logged in as[:\s]+(\S+@\S+)/i,
        /email[:\s]+(\S+@\S+)/i,
        /user[:\s]+(\S+@\S+)/i,
        /account[:\s]+(\S+@\S+)/i,
      ]
      for (const pattern of emailPatterns) {
        const match = stdout.match(pattern)
        if (match) {
          const info = { email: match[1] }
          cachedAccountInfoMap.set(this.providerId, info)
          return info
        }
      }

      return null
    } catch {
      return null
    }
  }

  async checkStatus(): Promise<ProviderStatusInfo> {
    const cached = cachedStatusMap.get(this.providerId)
    if (cached && Date.now() - cached.ts < STATUS_TTL_MS) return cached.result

    const result = await this._doCheckStatus()
    cachedStatusMap.set(this.providerId, { result, ts: Date.now() })
    return result
  }

  private async _doCheckStatus(): Promise<ProviderStatusInfo> {
    // Check installation cheaply first via which/where
    let installed = false
    try {
      await execFileAsync(process.platform === 'win32' ? 'where' : 'which', [this.config.command], {
        env: buildCliEnv(this.config),
        timeout: 3000,
      })
      installed = true
    } catch {
      return { installed: false, loggedIn: false }
    }

    // Check login status and extract email in one exec
    try {
      const { stdout } = await execFileAsync(this.config.command, ['agent', 'status'], {
        env: buildCliEnv(this.config),
        timeout: 5000,
      })

      const emailPatterns = [
        /Logged in as[:\s]+(\S+@\S+)/i,
        /email[:\s]+(\S+@\S+)/i,
        /user[:\s]+(\S+@\S+)/i,
        /account[:\s]+(\S+@\S+)/i,
      ]
      let email: string | undefined
      for (const pattern of emailPatterns) {
        const match = stdout.match(pattern)
        if (match) { email = match[1]; break }
      }

      if (email) {
        cachedAccountInfoMap.set(this.providerId, { email })
        return { installed: true, loggedIn: true, email }
      }

      return { installed: true, loggedIn: false }
    } catch {
      return { installed, loggedIn: false }
    }
  }

  async checkForChanges(): Promise<boolean> {
    const provider = getAcpProvider(this.providerId)
    if (!provider || !provider.isAlive() || !provider.supportsSessionList) {
      return false
    }

    try {
      const result = await provider.acpListSessions()
      const newCount = result.sessions.length
      const lastCount = lastSessionCountMap.get(this.providerId) ?? -1
      if (lastCount >= 0 && newCount !== lastCount) {
        lastSessionCountMap.set(this.providerId, newCount)
        return true
      }
      lastSessionCountMap.set(this.providerId, newCount)
      return false
    } catch {
      return false
    }
  }
}
