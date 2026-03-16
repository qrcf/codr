import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ProviderSessionDiscovery, DiscoveredSession, ProviderStatusInfo, DiscoveryContext } from '../../provider-discovery'
import { getCursorProvider } from './provider'
import { CursorEventNormalizer } from './normalizer'

const execFileAsync = promisify(execFile)

function buildCliEnv(): NodeJS.ProcessEnv {
  return { ...process.env }
}

// Cached account info
let cachedAccountInfo: { email?: string } | null = null
let lastSessionCount = -1

export class CursorSessionDiscovery implements ProviderSessionDiscovery {
  readonly providerId = 'cursor' as const

  async discoverSessions(_context: DiscoveryContext): Promise<DiscoveredSession[]> {
    const provider = getCursorProvider()
    if (!provider) return []

    if (!provider.isAlive()) {
      try {
        await provider.connect()
      } catch {
        return [] // Cursor ACP not available
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
            provider: 'cursor',
            title: s.title || null,
            workspaceDir: s.cwd || null,
            updatedAt: s.updatedAt ? new Date(s.updatedAt).getTime() : null,
          })
        }
        cursor = result.nextCursor ?? undefined
        pages++
      } while (cursor && pages < MAX_PAGES)

      lastSessionCount = sessions.length
      return sessions
    } catch (err) {
      console.error('[cursor-discovery] Failed to list sessions:', (err as Error).message)
      return []
    }
  }

  async getSessionMessages(sessionId: string, dir?: string): Promise<unknown[] | null> {
    const provider = getCursorProvider()
    if (!provider) return null

    if (!provider.isAlive()) {
      try {
        await provider.connect()
      } catch {
        return null
      }
    }

    try {
      // Create a normalizer in batch mode to collect replayed messages
      const normalizer = new CursorEventNormalizer(sessionId, 'batch')

      // Register handler before loading
      const unsub = provider.onSessionUpdate((sid, update) => {
        if (sid === sessionId) {
          normalizer.handleUpdate(update)
        }
      })

      // Load session — replays full history as session/update notifications
      await provider.acpLoadSession(sessionId, dir || process.cwd())

      // Finalize to emit any accumulated turn data
      normalizer.finalizeTurn()

      unsub()
      return normalizer.getMessages()
    } catch (err) {
      console.error('[cursor-discovery] Failed to load session messages:', (err as Error).message)
      return null
    }
  }

  async getAccountInfo(): Promise<{ email?: string } | null> {
    if (cachedAccountInfo) return cachedAccountInfo

    try {
      const { stdout } = await execFileAsync('cursor', ['agent', 'status'], {
        env: buildCliEnv(),
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
          cachedAccountInfo = { email: match[1] }
          return cachedAccountInfo
        }
      }

      return null
    } catch {
      return null
    }
  }

  async checkStatus(): Promise<ProviderStatusInfo> {
    // Check if cursor binary exists — try commands in order of reliability
    let installed = false
    for (const args of [['agent', 'about'], ['agent', '--version'], ['--version']]) {
      try {
        const result = await execFileAsync('cursor', args, { env: buildCliEnv(), timeout: 5000 })
        installed = true
        // If 'agent about' succeeded, try to extract email from its output
        if (args[0] === 'agent' && args[1] === 'about') {
          const emailMatch = result.stdout.match(/User Email[:\s]+(\S+@\S+)/i)
          if (emailMatch) {
            cachedAccountInfo = { email: emailMatch[1] }
          }
        }
        break
      } catch { /* try next */ }
    }

    if (!installed) {
      try {
        await execFileAsync(process.platform === 'win32' ? 'where' : 'which', ['cursor'], {
          env: buildCliEnv(), timeout: 3000,
        })
        installed = true
      } catch {
        return { installed: false, loggedIn: false }
      }
    }

    // Check login status
    try {
      const { stdout } = await execFileAsync('cursor', ['agent', 'status'], {
        env: buildCliEnv(),
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
        cachedAccountInfo = { email }
        return { installed: true, loggedIn: true, email }
      }

      // Installed but not logged in
      return { installed: true, loggedIn: false }
    } catch {
      // If status command failed but we know it's installed, try 'agent about' for email
      if (installed && !cachedAccountInfo) {
        try {
          const { stdout: aboutOut } = await execFileAsync('cursor', ['agent', 'about'], {
            env: buildCliEnv(), timeout: 5000,
          })
          const aboutMatch = aboutOut.match(/User Email[:\s]+(\S+@\S+)/i)
          if (aboutMatch) {
            cachedAccountInfo = { email: aboutMatch[1] }
            return { installed: true, loggedIn: true, email: aboutMatch[1] }
          }
        } catch { /* ignore */ }
      }
      return { installed, loggedIn: false }
    }
  }

  async checkForChanges(): Promise<boolean> {
    const provider = getCursorProvider()
    if (!provider || !provider.isAlive() || !provider.supportsSessionList) {
      return false
    }

    try {
      const result = await provider.acpListSessions()
      const newCount = result.sessions.length
      if (lastSessionCount >= 0 && newCount !== lastSessionCount) {
        lastSessionCount = newCount
        return true
      }
      lastSessionCount = newCount
      return false
    } catch {
      return false
    }
  }
}
