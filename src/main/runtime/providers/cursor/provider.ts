import { spawn, type ChildProcess } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import type {
  AgentProvider,
  AgentProviderContext,
  AgentQueryRequest,
  ProviderRunCallbacks,
  ProviderRunResult,
} from '../../provider'
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Client,
  type Agent,
  type AgentCapabilities,
  type SessionConfigOption,
  type SessionUpdate,
  type ContentBlock,
  type SessionConfigSelectOption,
  type SessionConfigSelectOptions,
  type SessionConfigSelectGroup,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type NewSessionResponse,
  type SessionNotification,
  type ListSessionsResponse,
} from '@agentclientprotocol/sdk'
import { CursorEventNormalizer, normalizeToolCall } from './normalizer'
import { preprocessPromptFull, buildContextSummary } from '../../prompt-preprocessor'
import { readAttachmentAsContentBlock } from '../../../attachments'
import { beginTitleGeneration, completeTitleGeneration } from '../../../sessions'
import { registerPendingPermission, registerPendingQuestion } from '../../../permissions'
import { updateCapability } from '../../provider-capabilities'

const ACP_DEBUG = process.env.ACP_DEBUG === '1'

type SessionUpdateHandler = (sessionId: string, update: SessionUpdate) => void

interface ActiveSession {
  normalizer: CursorEventNormalizer
  unsubSessionUpdate: () => void
}

// Module-level provider reference for discovery/models access
let sharedProvider: CursorProvider | null = null

export function getCursorProvider(): CursorProvider | null {
  return sharedProvider
}

export function setCursorProvider(provider: CursorProvider): void {
  sharedProvider = provider
}

export class CursorProvider implements AgentProvider {
  readonly id = 'cursor' as const
  private readonly activeSessions = new Map<string, ActiveSession>()
  private readonly ctx: AgentProviderContext

  // ACP connection state
  private connection: ClientSideConnection | null = null
  private child: ChildProcess | null = null
  private _capabilities: AgentCapabilities | null = null
  private _lastConfigOptions: SessionConfigOption[] | null = null
  private _alive = false
  private _authFailed = false

  // Per-query handler dispatch
  private sessionUpdateHandlers = new Set<SessionUpdateHandler>()
  private activePermissionHandler: ((params: RequestPermissionRequest) => Promise<RequestPermissionResponse>) | null = null
  private activeExtMethodHandler: ((method: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>) | null = null

  constructor(ctx: AgentProviderContext) {
    this.ctx = ctx
  }

  // --- Connection lifecycle ---

  async connect(): Promise<void> {
    if (this._alive) return

    this.child = spawn('cursor', ['agent', 'acp'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    if (ACP_DEBUG) {
      this.child.stderr?.on('data', (data: Buffer) => {
        console.log('[cursor:stderr]', data.toString().trimEnd())
      })
    }

    this.child.on('exit', () => {
      this._alive = false
      this.connection = null
    })

    this.child.on('error', (err) => {
      console.error('[cursor] Process error:', err.message)
    })

    const input = Writable.toWeb(this.child.stdin!) as WritableStream<Uint8Array>
    const output = Readable.toWeb(this.child.stdout!) as ReadableStream<Uint8Array>
    const stream = ndJsonStream(input, output)

    this.connection = new ClientSideConnection(
      (_agent: Agent) => this.buildClient(),
      stream,
    )

    const initResult = await this.connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: { name: 'codr', version: '1.0.0' },
    })

    this._capabilities = initResult.agentCapabilities ?? { loadSession: false }
    if (this._capabilities.sessionCapabilities?.list) {
      updateCapability('cursor', 'native-session-import', true)
    }

    try {
      await this.connection.authenticate({ methodId: 'cursor_login' })
      this._authFailed = false
    } catch (err) {
      this._authFailed = true
      console.warn('[cursor] Authentication failed:', (err as Error).message)
    }

    this._alive = true
  }

  isAlive(): boolean {
    return this._alive
  }

  get capabilities(): AgentCapabilities {
    return this._capabilities || { loadSession: false }
  }

  get supportsSessionList(): boolean {
    return this._capabilities?.sessionCapabilities?.list != null
  }

  get authFailed(): boolean {
    return this._authFailed
  }

  get lastConfigOptions(): SessionConfigOption[] | null {
    return this._lastConfigOptions
  }

  // --- ACP session operations (used by runQuery + discovery + models) ---

  async acpNewSession(cwd: string): Promise<NewSessionResponse> {
    this.ensureConnected()
    const result = await this.connection!.newSession({ cwd, mcpServers: [] })
    if (result.configOptions) {
      this._lastConfigOptions = result.configOptions
      this.processConfigOptions(result.configOptions)
    }
    return result
  }

  async acpLoadSession(sessionId: string, cwd: string): Promise<void> {
    this.ensureConnected()
    await this.connection!.loadSession({ sessionId, cwd, mcpServers: [] })
  }

  async acpPrompt(sessionId: string, content: ContentBlock[]): Promise<void> {
    this.ensureConnected()
    await this.connection!.prompt({ sessionId, prompt: content })
  }

  acpCancel(sessionId: string): void {
    if (!this._alive || !this.connection) return
    void this.connection.cancel({ sessionId })
  }

  async acpSetConfigOption(sessionId: string, configId: string, value: string): Promise<void> {
    this.ensureConnected()
    const result = await this.connection!.setSessionConfigOption({ sessionId, configId, value })
    if (result.configOptions) {
      this._lastConfigOptions = result.configOptions
      this.processConfigOptions(result.configOptions)
    }
  }

  async acpSetSessionMode(sessionId: string, modeId: string): Promise<void> {
    this.ensureConnected()
    await this.connection!.setSessionMode({ sessionId, modeId })
  }

  async acpListSessions(opts?: { cwd?: string; cursor?: string }): Promise<ListSessionsResponse> {
    this.ensureConnected()
    return this.connection!.listSessions(opts || {})
  }

  /** Subscribe to session update events. Returns unsubscribe function. */
  onSessionUpdate(handler: SessionUpdateHandler): () => void {
    this.sessionUpdateHandlers.add(handler)
    return () => { this.sessionUpdateHandlers.delete(handler) }
  }

  // --- AgentProvider interface ---

  async runQuery(req: AgentQueryRequest, callbacks: ProviderRunCallbacks): Promise<ProviderRunResult> {
    const isResume = !!req.resumeSessionId
    const isNewSession = !isResume
    let sessionId = req.resumeSessionId || ''
    let sessionIdentified = false

    // Eagerly start title generation for new sessions (runs in parallel with ACP setup)
    const eagerTitlePromise = isNewSession ? beginTitleGeneration(req.prompt) : null

    // Mode instruction — only for ask mode. Plan mode is handled entirely by the
    // ACP mode config option (set to 'plan' via applyModeConfig), so no prompt
    // instruction is needed — Cursor's native plan mode restricts the agent.
    const modeInstruction = req.askMode
      ? 'You are in ask mode. Answer the question without making edits or executing side effects. Only read, search, and explain.'
      : ''

    // Preprocess prompt (resolve @docs: and @file references)
    const { prompt: cleanedPrompt, contextChunks, contextString } = await preprocessPromptFull(
      this.ctx, req.prompt, req.cwd, { includeCodebaseContext: !isResume }
    )

    // Build ACP content blocks
    const contentBlocks = await this.buildContentBlocks(cleanedPrompt, modeInstruction, contextString, req)

    try {
      // Lazy-start ACP connection
      await this.connect().catch(err => {
        throw new Error(`Cursor ACP failed to start: ${extractErrorMessage(err)}`)
      })
      const authWarning = this._authFailed ? ' (authentication failed — check Cursor login)' : ''

      if (isResume) {
        await this.acpLoadSession(sessionId, req.cwd || process.cwd())
      } else {
        const result = await this.acpNewSession(req.cwd || process.cwd()).catch(err => {
          throw new Error(`Failed to create Cursor session${authWarning}: ${extractErrorMessage(err)}`)
        })
        sessionId = result.sessionId

        // Apply config options independently — each in its own try/catch so one
        // failure doesn't prevent the others from being set.
        if (result.configOptions) {
          if (req.model) {
            try { await this.applyModelConfig(sessionId, req.model, result.configOptions) }
            catch (e) { console.warn('[cursor] Model config failed:', extractErrorMessage(e)) }
          }
          if (req.thinkingBudget) {
            try { await this.applyThinkingConfig(sessionId, req.thinkingBudget, result.configOptions) }
            catch (e) { console.warn('[cursor] Thinking config failed:', extractErrorMessage(e)) }
          }
        }
        // Mode uses BOTH configOptions and legacy modes — run regardless
        try { await this.applyModeConfig(sessionId, req, result) }
        catch (e) { console.warn('[cursor] Mode config failed:', extractErrorMessage(e)) }
      }

      // Create normalizer and register session update handler
      const normalizer = new CursorEventNormalizer(sessionId, 'streaming', callbacks)
      const unsubSessionUpdate = this.onSessionUpdate((sid, update) => {
        if (sid === sessionId) {
          normalizer.handleUpdate(update)
        }
      })

      const active: ActiveSession = { normalizer, unsubSessionUpdate }
      this.activeSessions.set(sessionId, active)

      // Set permission handler for this query — routes through shared permission system.
      // Detects ACP-standard switch_mode (plan exit) and shows plan review dialog.
      this.activePermissionHandler = async (params: RequestPermissionRequest) => {
        if (params.sessionId && params.sessionId !== sessionId) {
          // Not for this session — auto-allow
          const allowOption = params.options.find(o => o.kind === 'allow_once')
          return { outcome: { outcome: 'selected' as const, optionId: allowOption?.optionId || 'allow-once' } }
        }

        const toolCall = params.toolCall

        // ACP-standard plan exit: agent sends switch_mode permission when ready to leave architect mode
        if (toolCall.kind === 'switch_mode') {
          return this.handlePlanExitPermission(sessionId, normalizer, params)
        }

        // Normalize tool name/input for the permission dialog
        const normalized = normalizeToolCall({
          name: toolCall.title || 'unknown',
          input: (toolCall.rawInput as Record<string, unknown>) || {},
          kind: toolCall.kind,
          content: toolCall.content as Array<{ type: string; [key: string]: unknown }>,
          locations: toolCall.locations as Array<{ path: string; line?: number | null }>,
        })

        const { id: permId, promise } = registerPendingPermission(sessionId)
        this.ctx.broadcaster.send('agent:permission-request', {
          id: permId,
          tool: normalized.name,
          input: normalized.input,
        }, sessionId)

        const { allowed } = await promise
        const findOption = (kind: string) => params.options.find(o => o.kind === kind)
        const optionId = allowed
          ? (findOption('allow_once') || findOption('allow_always'))?.optionId || 'allow-once'
          : (findOption('reject_once'))?.optionId || 'reject-once'
        return { outcome: { outcome: 'selected' as const, optionId } }
      }

      // Set extension method handler — dispatches by method name.
      this.activeExtMethodHandler = async (method: string, params: Record<string, unknown>) => {
        switch (method) {
          case 'cursor/create_plan': {
            // Cursor-specific plan creation — show plan review dialog
            // Prefer params.plan (full markdown) over sparse plan entries
            const p = params as { name?: string; overview?: string; plan?: string }
            const planContent = p.plan
              || normalizer.getPendingPlanEntries().map(e => `- [${e.status}] ${e.content}`).join('\n')
              || JSON.stringify(params, null, 2)

            const { id: permId, promise } = registerPendingPermission(sessionId)
            this.ctx.broadcaster.send('agent:permission-request', {
              id: permId,
              tool: 'ExitPlanMode',
              input: {
                plan: planContent,
                planContent,
                planFilePath: `cursor://plan/${sessionId}`,
                planTitle: p.name || undefined,
                provider: 'cursor',
              },
            }, sessionId)

            const { allowed, message } = await promise
            if (!allowed) return { feedback: message || 'User requested changes' }
            return { approved: true }
          }

          case 'cursor/ask_question': {
            const qParams = params as { questions?: Array<{ id: string; text: string; options?: Array<{ id: string; text: string }> }> }
            if (!qParams.questions || qParams.questions.length === 0) return {}

            const { id, promise } = registerPendingQuestion(sessionId)
            this.ctx.broadcaster.send('agent:question-request', {
              id,
              questions: qParams.questions,
            }, sessionId)

            const answers = await promise
            return { answers }
          }

          case 'cursor/update_todos': {
            const todoParams = params as { todos?: unknown[] }
            if (todoParams.todos) {
              callbacks.onMessage({
                type: 'assistant',
                session_id: sessionId,
                message: {
                  content: [{ type: 'tool_use', id: `cursor-todo-${Date.now()}`, name: 'TodoWrite', input: { todos: todoParams.todos } }],
                },
              }, sessionId)
            }
            return {}
          }

          default:
            return {}
        }
      }

      // Notify session identified
      callbacks.onSessionIdentified(sessionId)
      sessionIdentified = true

      // Attach eager title generation now that we have the session ID
      if (eagerTitlePromise) {
        completeTitleGeneration(sessionId, eagerTitlePromise)
      }

      // Emit injected context (also triggers draft→session adoption in the renderer
      // via session_id; user message is NOT emitted here because agent.ts's
      // onSessionIdentified already appends it to the index)
      const injectedContext = {
        mode: (req.askMode ? 'ask' : req.planMode ? 'plan' : 'code') as 'ask' | 'plan' | 'code',
        ...(contextString ? { systemPrompt: contextString } : {}),
        context: buildContextSummary(contextChunks),
      }
      callbacks.onMessage({ type: 'injected_context', session_id: sessionId, injectedContext }, sessionId)

      // Send prompt and wait for turn completion
      try {
        await this.acpPrompt(sessionId, contentBlocks)
      } catch (err) {
        const message = extractErrorMessage(err)
        callbacks.onError(`Cursor prompt failed${authWarning}: ${message}`, sessionId)
      }

      // Finalize turn — emit canonical assistant message
      normalizer.finalizeTurn()

      // Cleanup
      unsubSessionUpdate()
      this.activePermissionHandler = null
      this.activeExtMethodHandler = null
      this.activeSessions.delete(sessionId)

    } catch (err) {
      const message = extractErrorMessage(err)
      if (!sessionIdentified) {
        if (!sessionId) {
          sessionId = `cursor-failed-${Date.now()}-${Math.random().toString(36).slice(2)}`
        }
        callbacks.onSessionIdentified(sessionId)
        // Emit injected_context to trigger draft→session adoption in renderer
        // (user message is handled by agent.ts onSessionIdentified)
        callbacks.onMessage({
          type: 'injected_context',
          session_id: sessionId,
          injectedContext: { mode: (req.askMode ? 'ask' : req.planMode ? 'plan' : 'code') as 'ask' | 'plan' | 'code' },
        }, sessionId)
      }
      callbacks.onError(message, sessionId)
    } finally {
      callbacks.onDone(sessionId)
    }

    return { queryKey: sessionId }
  }

  async interruptQuery(sessionId?: string): Promise<void> {
    if (!this._alive) return

    if (sessionId) {
      this.acpCancel(sessionId)
      this.cleanupSession(sessionId)
    } else {
      for (const sid of this.activeSessions.keys()) {
        this.acpCancel(sid)
      }
      this.cleanupAllSessions()
    }
  }

  async forceCleanupAll(): Promise<string[]> {
    const sessionIds = [...this.activeSessions.keys()]
    for (const sid of sessionIds) {
      this.acpCancel(sid)
    }
    this.cleanupAllSessions()
    return sessionIds
  }

  // --- Private: ACP client callback ---

  private buildClient(): Client {
    return {
      sessionUpdate: async (params: SessionNotification) => {
        const { sessionId, update } = params

        if (ACP_DEBUG && !['agent_text_chunk', 'agent_thought_chunk'].includes(update.sessionUpdate)) {
          console.log('[cursor:update]', update.sessionUpdate, JSON.stringify(params).slice(0, 500))
        }

        // Track config option changes
        if (update.sessionUpdate === 'config_option_update') {
          const { configOptions } = update
          if (configOptions) {
            this._lastConfigOptions = configOptions
            this.processConfigOptions(configOptions)
          }
        }

        for (const handler of this.sessionUpdateHandlers) {
          try { handler(sessionId, update) } catch (err) {
            console.error('[cursor] Session update handler error:', err)
          }
        }
      },

      requestPermission: async (params: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
        if (ACP_DEBUG) console.log('[cursor:permission]', JSON.stringify(params).slice(0, 500))

        if (this.activePermissionHandler) {
          return this.activePermissionHandler(params)
        }
        // Default: allow once
        const allowOption = params.options.find(o => o.kind === 'allow_once')
        return {
          outcome: {
            outcome: 'selected' as const,
            optionId: allowOption?.optionId || params.options[0]?.optionId || 'allow-once',
          },
        }
      },

      extMethod: async (method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> => {
        if (ACP_DEBUG) console.log('[cursor:ext]', method, JSON.stringify(params).slice(0, 500))

        if (this.activeExtMethodHandler) {
          return this.activeExtMethodHandler(method, params)
        }
        return {}
      },
    }
  }

  // --- Private: Plan exit ---

  private async handlePlanExitPermission(
    sessionId: string,
    normalizer: CursorEventNormalizer,
    params: RequestPermissionRequest,
  ): Promise<{ outcome: { outcome: 'selected'; optionId: string }; feedback?: string }> {
    const toolCall = params.toolCall

    console.log('[cursor] switch_mode toolCall:', JSON.stringify(toolCall, null, 2))

    const permissionPlanText = (toolCall.content || [])
      .map((c: Record<string, unknown>) => {
        if (c.type === 'content' && c.content && typeof c.content === 'object') {
          const inner = c.content as Record<string, unknown>
          if (inner.type === 'text' && typeof inner.text === 'string') return inner.text
        }
        if (c.type === 'text' && typeof c.text === 'string') return c.text as string
        return ''
      })
      .filter(Boolean)
      .join('\n')

    const planEntries = normalizer.getPendingPlanEntries()
    const entriesText = planEntries.length > 0
      ? planEntries.map(e => `- [${e.status}] ${e.content}`).join('\n')
      : ''

    const planContent = permissionPlanText || entriesText || 'No plan content available'

    const { id: permId, promise } = registerPendingPermission(sessionId)
    this.ctx.broadcaster.send('agent:permission-request', {
      id: permId,
      tool: 'ExitPlanMode',
      input: { plan: planContent, planContent, planFilePath: `cursor://plan/${sessionId}`, provider: 'cursor' },
    }, sessionId)

    const { allowed, message } = await promise

    if (allowed) {
      const codeOption = params.options.find(o => o.optionId === 'code')
        || params.options.find(o => o.kind === 'allow_once')
        || params.options.find(o => o.kind === 'allow_always')
      return { outcome: { outcome: 'selected' as const, optionId: codeOption?.optionId || params.options[0]?.optionId || 'allow-once' } }
    } else {
      const rejectOption = params.options.find(o => o.kind === 'reject_once')
      return {
        outcome: { outcome: 'selected' as const, optionId: rejectOption?.optionId || 'reject' },
        ...(message ? { feedback: message } : {}),
      }
    }
  }

  // --- Private: Content blocks ---

  private async buildContentBlocks(
    prompt: string,
    modeInstruction: string,
    contextString: string,
    req: AgentQueryRequest,
  ): Promise<ContentBlock[]> {
    const blocks: ContentBlock[] = []

    // Combine prompt with mode instruction and context
    const fullPrompt = [modeInstruction, contextString, prompt].filter(Boolean).join('\n\n')
    blocks.push({ type: 'text', text: fullPrompt })

    // Add attachments
    if (req.attachments && req.attachments.length > 0) {
      const supportsImage = this._capabilities?.promptCapabilities?.image === true

      for (const att of req.attachments) {
        if (att.category === 'image' && supportsImage) {
          try {
            const block = await readAttachmentAsContentBlock(att)
            if (block.type === 'image') {
              blocks.push({
                type: 'image',
                data: (block as { source?: { data: string } }).source?.data || '',
                mimeType: (block as { source?: { media_type: string } }).source?.media_type || 'image/png',
              })
            }
          } catch {
            blocks.push({ type: 'text', text: `[Image: ${att.originalName}]` })
          }
        } else if (att.category === 'image') {
          blocks.push({ type: 'text', text: `[Image: ${att.originalName}]` })
        } else {
          try {
            const block = await readAttachmentAsContentBlock(att)
            blocks.push({ type: 'text', text: (block as { text?: string }).text || `[Attachment: ${att.originalName}]` })
          } catch {
            blocks.push({ type: 'text', text: `[Failed to read attachment: ${att.originalName}]` })
          }
        }
      }
    }

    return blocks
  }

  // --- Private: Config application ---

  private async applyModelConfig(sessionId: string, model: string, configOptions: SessionConfigOption[]): Promise<void> {
    const modelOpt = configOptions.find(o => o.category === 'model')
    if (modelOpt) {
      await this.acpSetConfigOption(sessionId, modelOpt.id, model)
    }
  }

  /**
   * Set the ACP session mode. Strategy:
   * 1. Try config option (preferred per ACP spec) — look for category: 'mode'
   * 2. Fall back to legacy session/set_mode
   *
   * Cursor uses 'plan'/'agent'/'ask'; ACP spec examples use 'architect'/'code'/'ask'.
   * We try Cursor's IDs first, then spec IDs as fallback.
   */
  private async applyModeConfig(sessionId: string, req: AgentQueryRequest, result: NewSessionResponse): Promise<void> {
    // Cursor: plan/agent/ask. ACP spec: architect/code/ask. Try both.
    const candidates = req.askMode
      ? ['ask']
      : req.planMode
        ? ['plan', 'architect']
        : ['agent', 'code']

    // 1. Try config options (preferred per ACP spec)
    const modeOpt = result.configOptions?.find(o => o.category === 'mode')
    if (modeOpt && modeOpt.type === 'select') {
      const flatOptions = flattenSelectOptions(modeOpt.options)
      const match = candidates.find(c => flatOptions.some(o => o.value === c))
      if (match) {
        console.log(`[cursor] Setting mode via config option: ${match}`)
        await this.acpSetConfigOption(sessionId, modeOpt.id, match)
        return
      }
      console.warn(`[cursor] No matching mode in config options [${flatOptions.map(o => o.value).join(', ')}]`)
    }

    // 2. Fall back to legacy session/set_mode
    if (result.modes?.availableModes) {
      const match = candidates.find(c => result.modes!.availableModes.some(m => m.id === c))
      if (match) {
        console.log(`[cursor] Setting mode via legacy setSessionMode: ${match}`)
        await this.acpSetSessionMode(sessionId, match)
        return
      }
      console.warn(`[cursor] No matching mode in available modes [${result.modes.availableModes.map(m => m.id).join(', ')}]`)
    }

    console.warn(`[cursor] Could not set mode — tried candidates [${candidates.join(', ')}]`)
  }

  private async applyThinkingConfig(sessionId: string, budget: 'low' | 'medium' | 'high', configOptions: SessionConfigOption[]): Promise<void> {
    const thoughtOpt = configOptions.find(o => o.category === 'thought_level')
    if (thoughtOpt && thoughtOpt.type === 'select') {
      // Map Codr's budget to closest ACP option
      const flatOptions = flattenSelectOptions(thoughtOpt.options)
      const targetValue = flatOptions.find(o =>
        o.value.toLowerCase().includes(budget) || o.name.toLowerCase().includes(budget)
      )?.value || budget
      await this.acpSetConfigOption(sessionId, thoughtOpt.id, targetValue)
    }
  }

  // --- Private: Cleanup & helpers ---

  private cleanupSession(sessionId: string): void {
    const active = this.activeSessions.get(sessionId)
    if (active) {
      active.unsubSessionUpdate()
      this.activeSessions.delete(sessionId)
    }
  }

  private cleanupAllSessions(): void {
    for (const [sid] of this.activeSessions) {
      this.cleanupSession(sid)
    }
  }

  private ensureConnected(): void {
    if (!this._alive || !this.connection) {
      throw new Error('Cursor ACP not connected')
    }
  }

  private processConfigOptions(configOptions: SessionConfigOption[]): void {
    const hasModel = configOptions.some(opt => opt.category === 'model')
    const hasThoughtLevel = configOptions.some(opt => opt.category === 'thought_level')
    updateCapability('cursor', 'model-selection', hasModel)
    updateCapability('cursor', 'reasoning-control', hasThoughtLevel)
  }
}

/** Extract a human-readable message from an error (handles JSON-RPC error objects from SDK) */
function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message
  }
  return JSON.stringify(err)
}

/** Flatten SessionConfigSelectOptions (may be grouped) into flat option array */
function flattenSelectOptions(options: SessionConfigSelectOptions): SessionConfigSelectOption[] {
  if (options.length === 0) return []
  if ('group' in options[0]) {
    return (options as SessionConfigSelectGroup[]).flatMap(g => g.options)
  }
  return options as SessionConfigSelectOption[]
}
