import { ipcMain, type BrowserWindow } from 'electron'
import { registerPermissionHandlers, type MessageOrigin } from './permissions'
import type { EventBroadcaster } from './event-broadcaster'
import type { RelayClient } from './relay-client'
import { setCachedAccountInfo } from './sessions'
import { getSelectedProvider, setSelectedProvider } from './runtime/provider-config'
import { appendIndexedRawMessage, getIndexedSessionMeta, upsertIndexedSession } from './runtime/session-index'
import { ClaudeProvider, getClaudeCliPath } from './runtime/providers/claude-provider'
import { CodexProvider } from './runtime/providers/codex-provider'
import type { AgentProvider, AgentProviderId, AgentProviderContext } from './runtime/provider'
import { resolveSessionProvider } from './runtime/session-records'

export function getCliPath(): string | undefined {
  return getClaudeCliPath()
}

export function registerAgentHandlers(
  getMainWindow: () => BrowserWindow | null,
  broadcaster: EventBroadcaster,
  relayClient: RelayClient,
) {
  registerPermissionHandlers(broadcaster)
  const providerContext: AgentProviderContext = {
    broadcaster,
    relayClient,
    sessionStore: {
      upsertSessionMetadata: async (sessionId, data) => {
        await upsertIndexedSession(sessionId, {
          provider: data.provider,
          firstPrompt: data.firstPrompt ?? undefined,
          title: data.title ?? undefined,
          workspaceDir: data.workspaceDir ?? undefined,
          providerSessionId: data.providerSessionId ?? undefined,
        })
      },
      putRawMessages: async (sessionId, provider, rawMessages) => {
        await appendIndexedRawMessage(sessionId, provider, { type: 'session_snapshot', rawMessages })
      },
      appendRawMessage: async (sessionId, provider, rawMessage) => {
        await appendIndexedRawMessage(sessionId, provider, rawMessage)
      },
    },
  }
  const providers: Record<AgentProviderId, AgentProvider> = {
    claude: new ClaudeProvider(providerContext),
    codex: new CodexProvider(providerContext),
  }

  // Run a query (used by both IPC and relay-forwarded commands)
  async function runQuery(prompt: string, resumeSessionId?: string, planMode?: boolean, cwd?: string, askMode?: boolean, origin: MessageOrigin = 'local') {
    const selectedProvider = await getSelectedProvider()
    const storedSession = resumeSessionId ? await getIndexedSessionMeta(resumeSessionId) : null
    const providerId = resolveSessionProvider(selectedProvider, storedSession?.provider)
    const provider = providers[providerId]
    const tempKey = resumeSessionId || `new-${Date.now()}-${Math.random().toString(36).slice(2)}`
    let currentKey = tempKey

    broadcaster.markQueryStart(currentKey, prompt)

    await provider.runQuery(
      { prompt, resumeSessionId, planMode, cwd, askMode, origin },
      {
        onSessionIdentified: (sessionId) => {
          if (sessionId === currentKey) return
          broadcaster.updateQuerySessionId(currentKey, sessionId)
          currentKey = sessionId
          void upsertIndexedSession(sessionId, {
            provider: providerId,
            firstPrompt: prompt,
            workspaceDir: cwd ?? undefined,
            providerSessionId: sessionId,
            status: 'active',
          })
          // Do NOT send refresh-hint here — it races with draft promotion in the renderer.
          // The onDone callback sends it after the session is fully complete.
        },
        onMessage: (message, querySessionId) => {
          broadcaster.send('agent:message', message, querySessionId)
          void appendIndexedRawMessage(querySessionId, providerId, message)
        },
        onError: (errorText, querySessionId) => {
          broadcaster.send('agent:error', errorText, querySessionId)
          void upsertIndexedSession(querySessionId, { provider: providerId, status: 'error' })
        },
        onDone: (querySessionId) => {
          broadcaster.send('agent:done', undefined, querySessionId)
          broadcaster.send('sessions:refresh-hint')
          void upsertIndexedSession(querySessionId, { provider: providerId, status: 'done' })
        },
        onAccountInfo: (info) => {
          setCachedAccountInfo(info as Parameters<typeof setCachedAccountInfo>[0])
          const win = getMainWindow()
          if (win && !win.isDestroyed()) {
            win.webContents.send('sessions:account-info-update', info)
          }
        },
      },
    )
  }

  async function interruptQuery(sessionId?: string) {
    const providerId = await getSelectedProvider()
    await providers[providerId].interruptQuery(sessionId)
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

  ipcMain.handle('agent:get-provider', async () => {
    return getSelectedProvider()
  })

  ipcMain.handle('agent:set-provider', async (_event, provider: AgentProviderId) => {
    if (provider !== 'claude' && provider !== 'codex') return { error: 'Invalid provider' }
    const selected = await setSelectedProvider(provider)
    broadcaster.send('sessions:refresh-hint')
    return { provider: selected }
  })

  // Return functions for relay-forwarded commands
  return { runQuery, interruptQuery } as const
}
