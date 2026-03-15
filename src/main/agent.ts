import { ipcMain, type BrowserWindow } from 'electron'
import { registerPermissionHandlers, rejectPendingForSession, type MessageOrigin } from './permissions'
import type { EventBroadcaster } from './event-broadcaster'
import type { RelayClient } from './relay-client'
import { setCachedAccountInfo } from './sessions'
import { getSelectedProvider, setSelectedProvider, getSelectedModel, setSelectedModel, getClaudeSettingsDefaults } from './runtime/provider-config'
import { getModelsForProvider } from './runtime/models'
import { appendIndexedRawMessage, getIndexedSessionMeta, putIndexedRawMessages, upsertIndexedSession } from './runtime/session-index'
import { shouldPersistIndexedMessage } from './runtime/session-index-storage'
import { ClaudeProvider, getClaudeCliPath } from './runtime/providers/claude-provider'
import { CodexProvider } from './runtime/providers/codex-provider'
import type { AgentProvider, AgentProviderId, AgentProviderContext } from './runtime/provider'
import { resolveSessionProvider } from './runtime/session-records'
import type { IndexerManager } from './indexer/manager'
import type { AttachmentMeta } from '../shared/attachments'

export function getCliPath(): string | undefined {
  return getClaudeCliPath()
}

export function registerAgentHandlers(
  getMainWindow: () => BrowserWindow | null,
  broadcaster: EventBroadcaster,
  relayClient: RelayClient,
  getAuthToken: () => Promise<string>,
  indexerManager?: IndexerManager,
) {
  registerPermissionHandlers(broadcaster)
  const providerContext: AgentProviderContext = {
    broadcaster,
    indexerManager,
    relayClient,
    getAuthToken,
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
        await putIndexedRawMessages(sessionId, provider, rawMessages)
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
  async function runQuery(prompt: string, resumeSessionId?: string, planMode?: boolean, cwd?: string, askMode?: boolean, origin: MessageOrigin = 'local', model?: string, thinkingBudget?: 'low' | 'medium' | 'high', attachments?: AttachmentMeta[]) {
    const selectedProvider = await getSelectedProvider()
    const storedSession = resumeSessionId ? await getIndexedSessionMeta(resumeSessionId) : null
    const providerId = resolveSessionProvider(selectedProvider, storedSession?.provider)
    const provider = providers[providerId]
    const resolvedModel = model ?? storedSession?.model ?? await getSelectedModel(providerId)
    const resolvedCwd = cwd ?? storedSession?.workspaceDir ?? undefined
    let currentKey = resumeSessionId || `new-${Date.now()}-${Math.random().toString(36).slice(2)}`

    broadcaster.markQueryStart(currentKey, prompt)

    let errorOccurred = false

    await provider.runQuery(
      { prompt, resumeSessionId, planMode, cwd: resolvedCwd, askMode, origin, model: resolvedModel, thinkingBudget, attachments },
      {
        onSessionIdentified: (sessionId) => {
          if (sessionId === currentKey) {
            // Resume — still update model + reasoning for this query
            void upsertIndexedSession(sessionId, {
              provider: providerId,
              model: resolvedModel,
              thinkingBudget: thinkingBudget || null,
            })
          } else {
            broadcaster.updateQuerySessionId(currentKey, sessionId)
            currentKey = sessionId
            void upsertIndexedSession(sessionId, {
              provider: providerId,
              firstPrompt: prompt,
              workspaceDir: cwd ?? undefined,
              providerSessionId: sessionId,
              status: 'active',
              model: resolvedModel,
              thinkingBudget: thinkingBudget || null,
            })
            // Do NOT send refresh-hint here — it races with draft promotion in the renderer.
            // The onDone callback sends it after the session is fully complete.
          }
          // Index the user's prompt so it survives reload (the SDK iterator
          // does not emit it — only assistant responses and tool_result blocks).
          void appendIndexedRawMessage(sessionId, providerId, {
            type: 'user',
            message: { role: 'user', content: [{ type: 'text', text: prompt }] },
            session_id: sessionId,
            parent_tool_use_id: null,
            uuid: `synth-user-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          })
        },
        onMessage: (message, querySessionId) => {
          broadcaster.send('agent:message', message, querySessionId)
          if (shouldPersistIndexedMessage(message)) {
            void appendIndexedRawMessage(querySessionId, providerId, message)
          }
        },
        onError: (errorText, querySessionId) => {
          errorOccurred = true
          broadcaster.send('agent:error', errorText, querySessionId)
          void upsertIndexedSession(querySessionId, { provider: providerId, status: 'error' })
        },
        onDone: (querySessionId) => {
          broadcaster.send('agent:done', undefined, querySessionId)
          broadcaster.send('sessions:refresh-hint')
          // Don't overwrite 'error' status with 'done'
          if (!errorOccurred) {
            void upsertIndexedSession(querySessionId, { provider: providerId, status: 'done' })
          }
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
  ipcMain.handle('agent:query', async (_event, prompt: string, opts?: { resumeSessionId?: string; planMode?: boolean; cwd?: string; askMode?: boolean; model?: string; thinkingBudget?: 'low' | 'medium' | 'high'; attachments?: AttachmentMeta[] }) => {
    const win = getMainWindow()
    if (!win) return
    try {
      await runQuery(prompt, opts?.resumeSessionId, opts?.planMode, opts?.cwd, opts?.askMode, 'local', opts?.model, opts?.thinkingBudget, opts?.attachments)
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err)
      const fallbackKey = opts?.resumeSessionId || null
      broadcaster.send('agent:error', errorText, fallbackKey)
      broadcaster.send('agent:done', undefined, fallbackKey)
    }
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

  ipcMain.handle('agent:get-models', async (_event, provider?: AgentProviderId) => {
    const p = provider || await getSelectedProvider()
    const [models, selectedModel] = await Promise.all([
      getModelsForProvider(p),
      getSelectedModel(p),
    ])
    return { models, selectedModel }
  })

  ipcMain.handle('agent:set-model', async (_event, provider: AgentProviderId, model: string | undefined) => {
    await setSelectedModel(provider, model)
    return { model }
  })

  ipcMain.handle('agent:get-defaults', () => {
    return getClaudeSettingsDefaults()
  })

  async function forceCleanupAll(errorMessage: string) {
    let cleanedUp = 0
    for (const [providerId, provider] of Object.entries(providers)) {
      const sessionIds = await provider.forceCleanupAll()
      cleanedUp += sessionIds.length
      for (const sessionId of sessionIds) {
        const rejected = rejectPendingForSession(sessionId, errorMessage)
        for (const permissionId of rejected.permissionIds) {
          broadcaster.clearPermissionRequest(permissionId)
        }
        for (const questionId of rejected.questionIds) {
          broadcaster.clearQuestionRequest(questionId)
        }
        broadcaster.forceCleanup(sessionId, errorMessage)
        void upsertIndexedSession(sessionId, { provider: providerId as AgentProviderId, status: 'error' })
      }
    }
    if (cleanedUp > 0) {
      broadcaster.send('sessions:refresh-hint')
    }
  }

  // Return functions for relay-forwarded commands
  return { runQuery, interruptQuery, forceCleanupAll } as const
}
