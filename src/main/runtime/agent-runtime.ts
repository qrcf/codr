import { getSelectedProvider, setSelectedProvider } from './provider-config'
import { appendIndexedRawMessage, putIndexedRawMessages, upsertIndexedSession } from './session-index'
import type { AgentProvider, AgentProviderId, AgentProviderContext, AgentQueryRequest } from './provider'
import { ClaudeProvider } from './providers/claude-provider'
import { CodexProvider } from './providers/codex-provider'

export class AgentRuntime {
  private readonly providers: Record<AgentProviderId, AgentProvider>
  private readonly ctx: AgentProviderContext

  constructor(ctx: AgentProviderContext) {
    this.ctx = ctx
    this.providers = {
      claude: new ClaudeProvider(ctx),
      codex: new CodexProvider(ctx),
    }
  }

  async getProviderId(): Promise<AgentProviderId> {
    return getSelectedProvider()
  }

  async setProviderId(provider: AgentProviderId): Promise<AgentProviderId> {
    return setSelectedProvider(provider)
  }

  private async resolveProvider(): Promise<AgentProvider> {
    const providerId = await this.getProviderId()
    return this.providers[providerId]
  }

  async runQuery(req: AgentQueryRequest): Promise<void> {
    const provider = await this.resolveProvider()
    const providerId = provider.id
    await provider.runQuery(req, {
      onSessionIdentified: (sessionId) => {
        void upsertIndexedSession(sessionId, {
          provider: providerId,
          firstPrompt: req.prompt,
          workspaceDir: req.cwd || null,
          providerSessionId: sessionId,
        })
      },
      onMessage: (message, querySessionId) => {
        this.ctx.broadcaster.send('agent:message', message, querySessionId)
        void appendIndexedRawMessage(querySessionId, providerId, message)
      },
      onError: (errorText, querySessionId) => {
        this.ctx.broadcaster.send('agent:error', errorText, querySessionId)
        void upsertIndexedSession(querySessionId, { provider: providerId, status: 'error' })
      },
      onDone: (querySessionId) => {
        this.ctx.broadcaster.send('agent:done', undefined, querySessionId)
        this.ctx.broadcaster.send('sessions:refresh-hint')
        void upsertIndexedSession(querySessionId, { provider: providerId, status: 'done' })
      },
    })
  }

  async interruptQuery(sessionId?: string): Promise<void> {
    const provider = await this.resolveProvider()
    await provider.interruptQuery(sessionId)
  }

  async hydrateSessionFromProvider(sessionId: string, provider: AgentProviderId, messages: unknown[]): Promise<void> {
    await putIndexedRawMessages(sessionId, provider, messages)
  }
}
