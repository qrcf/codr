import { existsSync } from 'node:fs'
import { stat as fsStat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { ProviderSessionDiscovery, DiscoveredSession, ProviderStatusInfo, DiscoveryContext } from '../provider-discovery'
import { listCodexThreads, getCodexThreadRolloutPath, getCodexDbPath_exported } from '../codex-discovery'
import { parseCodexRollout } from '../codex-rollout-parser'

function normalizeOrg(raw?: string): string {
  if (!raw || raw.endsWith('\u2019s Organization') || raw.endsWith("'s Organization")) return 'Personal'
  return raw
}

export class CodexSessionDiscovery implements ProviderSessionDiscovery {
  readonly providerId = 'codex' as const
  private lastMtime = 0

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async discoverSessions(_context: DiscoveryContext): Promise<DiscoveredSession[]> {
    // listCodexThreads is synchronous (node:sqlite)
    const threads = listCodexThreads()
    return threads.map(thread => ({
      sessionId: thread.id,
      provider: 'codex' as const,
      title: thread.title || null,
      firstPrompt: thread.firstUserMessage || null,
      workspaceDir: thread.cwd || null,
      updatedAt: thread.updatedAt,
    }))
  }

  async getSessionMessages(sessionId: string): Promise<unknown[] | null> {
    const rolloutPath = getCodexThreadRolloutPath(sessionId)
    if (rolloutPath && existsSync(rolloutPath)) {
      const messages = await parseCodexRollout(rolloutPath, sessionId)
      return messages as unknown[]
    }
    return null
  }

  async getAccountInfo(): Promise<unknown | null> {
    return { tokenSource: 'openai-codex' }
  }

  async checkStatus(): Promise<ProviderStatusInfo> {
    const codexHome = join(homedir(), '.codex')
    const installed = existsSync(codexHome)
    if (!installed) return { installed: false, loggedIn: false }

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

        if (planType) {
          return { installed: true, loggedIn: true, detail: planType }
        }
      }
    } catch { /* auth.json read failed */ }

    return { installed: true, loggedIn: true, detail: baseDetail }
  }

  async checkForChanges(): Promise<boolean> {
    const codexDbPath = getCodexDbPath_exported()
    const s = await fsStat(codexDbPath).catch(() => null)
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
