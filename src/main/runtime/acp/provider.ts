import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'
import type {
  AgentProvider,
  AgentProviderContext,
  AgentQueryRequest,
  ProviderRunCallbacks,
  ProviderRunResult,
} from '../provider'
import type { AgentProviderId } from '../../../shared/provider-types'
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
import { AcpStreamAdapter } from './stream-adapter'
import type { AcpAgentConfig, AcpExtensionContext } from './agent-config'
import { preprocessPromptFull, buildContextSummary, buildDocsTOC } from '../prompt-preprocessor'
import { readAttachmentAsContentBlock } from '../../attachments'
import { beginTitleGeneration, completeTitleGeneration } from '../../sessions'
import {
  registerPendingPermission,
  registerPendingQuestion,
  classifyAcpTool,
  evaluatePermission,
  getEffectiveAskMode,
  isAskAll,
} from '../../permissions'
import { updateCapability } from '../provider-capabilities'
import { updateModelCacheFromConfigOptions } from '../models'

/** Merge structured req.docNames with regex-parsed doc names, deduplicating. */
function mergeDocNames(structured: string[] | undefined, parsed: string[]): string[] {
  if (!structured?.length && !parsed.length) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const n of [...(structured ?? []), ...parsed]) {
    if (!seen.has(n)) { seen.add(n); result.push(n) }
  }
  return result
}

const ACP_DEBUG = process.env.ACP_DEBUG === '1'

// --- Per-session wire logging ---

let _acpLogDir: string | null = null

function getAcpLogDir(): string {
  if (_acpLogDir) return _acpLogDir
  // Lazy-resolve: electron app module may not be ready at import time
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron')
    _acpLogDir = path.join(app.getPath('userData'), 'acp-logs')
  } catch {
    _acpLogDir = path.join(process.cwd(), '.acp-logs')
  }
  mkdirSync(_acpLogDir, { recursive: true })
  return _acpLogDir
}

function logAcpEvent(sessionId: string, event: string, data: unknown): void {
  try {
    const logPath = path.join(getAcpLogDir(), `${sessionId}.jsonl`)
    const line = JSON.stringify({ ts: new Date().toISOString(), event, data }) + '\n'
    appendFileSync(logPath, line)
  } catch {
    // Never crash on logging failure
  }
}

type SessionUpdateHandler = (sessionId: string, update: SessionUpdate) => void

interface ActiveSession {
  adapter: AcpStreamAdapter
  unsubSessionUpdate: () => void
}

export class AcpProvider implements AgentProvider {
  readonly id: AgentProviderId
  readonly handlesOwnStorage = true
  private readonly config: AcpAgentConfig
  private readonly activeSessions = new Map<string, ActiveSession>()
  private readonly ctx: AgentProviderContext
  private readonly tag: string

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

  constructor(config: AcpAgentConfig, ctx: AgentProviderContext) {
    this.id = config.providerId
    this.config = config
    this.ctx = ctx
    this.tag = config.logTag || config.providerId
  }

  // --- Connection lifecycle ---

  async connect(): Promise<void> {
    if (this._alive) return

    this.child = spawn(this.config.command, this.config.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.config.env },
    })

    if (ACP_DEBUG) {
      this.child.stderr?.on('data', (data: Buffer) => {
        console.log(`[${this.tag}:stderr]`, data.toString().trimEnd())
      })
    }

    this.child.on('exit', () => {
      this._alive = false
      this.connection = null
    })

    this.child.on('error', (err) => {
      console.error(`[${this.tag}] Process error:`, err.message)
    })

    const input = Writable.toWeb(this.child.stdin!) as WritableStream<Uint8Array>
    const rawOutput = Readable.toWeb(this.child.stdout!) as ReadableStream<Uint8Array>

    let output: ReadableStream<Uint8Array>
    if (ACP_DEBUG) {
      const rawLogPath = path.join(getAcpLogDir(), `${this.child.pid}-stdio.log`)
      const [logBranch, sdkBranch] = rawOutput.tee()
      output = sdkBranch

      // Consume log branch in background — write raw bytes to file
      void (async () => {
        const reader = logBranch.getReader()
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            appendFileSync(rawLogPath, `[OUT ${new Date().toISOString()}] ${new TextDecoder().decode(value)}`)
          }
        } catch { /* never crash on logging */ }
      })()

      // Wrap stdin to log outbound messages
      const stdinRef = this.child.stdin!
      const origWrite = stdinRef.write.bind(stdinRef)
      stdinRef.write = function (chunk: unknown, encodingOrCb?: unknown, cb?: unknown) {
        try {
          appendFileSync(rawLogPath, `[IN  ${new Date().toISOString()}] ${Buffer.isBuffer(chunk) ? chunk.toString() : chunk}\n`)
        } catch { /* never crash on logging */ }
        return origWrite(chunk as Uint8Array, encodingOrCb as BufferEncoding, cb as () => void)
      } as typeof stdinRef.write
    } else {
      output = rawOutput
    }

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
      updateCapability(this.id, 'native-session-import', true)
    }

    if (this.config.authMethodId) {
      try {
        await this.connection.authenticate({ methodId: this.config.authMethodId })
        this._authFailed = false
      } catch (err) {
        this._authFailed = true
        console.warn(`[${this.tag}] Authentication failed:`, (err as Error).message)
      }
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
    // Translate Claude's /compact to ACP's /summarize slash command
    if (req.prompt === '/compact') {
      req = { ...req, prompt: '/summarize' }
    }

    const isResume = !!req.resumeSessionId
    const isNewSession = !isResume
    let sessionId = req.resumeSessionId || ''
    let sessionIdentified = false

    // Eagerly start title generation for new sessions (runs in parallel with ACP setup)
    const eagerTitlePromise = isNewSession ? beginTitleGeneration(req.prompt) : null

    // Mode instruction — only for ask mode. Plan mode is handled entirely by the
    // ACP mode config option, so no prompt instruction is needed.
    const modeInstruction = req.askMode
      ? 'You are in ask mode. Answer the question without making edits or executing side effects. Only read, search, and explain.'
      : ''

    // Preprocess prompt (resolve @docs: and @file references)
    const { prompt: cleanedPrompt, contextChunks, contextString, docNames: parsedDocNames } = await preprocessPromptFull(
      this.ctx, req.prompt, req.cwd, { includeCodebaseContext: !isResume }
    )

    // Merge structured docNames from request with any manually typed @docs: tokens in the prompt
    const docNames = mergeDocNames(req.docNames, parsedDocNames)
    const docsTOC = docNames.length > 0 ? buildDocsTOC(docNames) : ''

    // Build ACP content blocks
    const contentBlocks = await this.buildContentBlocks(cleanedPrompt, modeInstruction, [contextString, docsTOC].filter(Boolean).join('\n\n'), req)

    try {
      // Lazy-start ACP connection
      await this.connect().catch(err => {
        throw new Error(`${this.tag} ACP failed to start: ${extractErrorMessage(err)}`)
      })
      const authWarning = this._authFailed ? ` (authentication failed — check ${this.tag} login)` : ''

      if (isResume) {
        await this.acpLoadSession(sessionId, req.cwd || process.cwd())
      } else {
        const result = await this.acpNewSession(req.cwd || process.cwd()).catch(err => {
          throw new Error(`Failed to create ${this.tag} session${authWarning}: ${extractErrorMessage(err)}`)
        })
        sessionId = result.sessionId

        // Apply config options independently — each in its own try/catch so one
        // failure doesn't prevent the others from being set.
        if (result.configOptions) {
          if (req.model) {
            try { await this.applyModelConfig(sessionId, req.model, result.configOptions) }
            catch (e) { console.warn(`[${this.tag}] Model config failed:`, extractErrorMessage(e)) }
          }
          if (req.thinkingBudget) {
            try { await this.applyThinkingConfig(sessionId, req.thinkingBudget, result.configOptions) }
            catch (e) { console.warn(`[${this.tag}] Thinking config failed:`, extractErrorMessage(e)) }
          }
        }
        // Mode uses BOTH configOptions and legacy modes — run regardless
        try { await this.applyModeConfig(sessionId, req, result) }
        catch (e) { console.warn(`[${this.tag}] Mode config failed:`, extractErrorMessage(e)) }
      }

      // Create stream adapter and register session update handler
      const adapter = new AcpStreamAdapter(this.id, sessionId, callbacks)
      const unsubSessionUpdate = this.onSessionUpdate((sid, update) => {
        if (sid === sessionId) {
          adapter.handleUpdate(update)
          // Store the raw ACP event
          this.ctx.sessionStore.appendRawMessage(sessionId, this.id, update)
        }
      })

      const active: ActiveSession = { adapter, unsubSessionUpdate }
      this.activeSessions.set(sessionId, active)

      // Set permission handler for this query — routes through shared permission system.
      // Uses the same evaluatePermission() logic as the Claude SDK provider.
      const origin = req.origin ?? 'local'
      const effectiveAskMode = getEffectiveAskMode(req.askMode || false, origin)
      const askAll = isAskAll(origin)

      this.activePermissionHandler = async (params: RequestPermissionRequest) => {
        if (params.sessionId && params.sessionId !== sessionId) {
          // Not for this session — auto-allow
          const allowOption = params.options.find(o => o.kind === 'allow_once')
          return { outcome: { outcome: 'selected' as const, optionId: allowOption?.optionId || 'allow-once' } }
        }

        const toolCall = params.toolCall
        const findOption = (kind: string) => params.options.find(o => o.kind === kind)

        // ACP-standard plan exit: agent sends switch_mode permission when ready to leave architect mode
        if (toolCall.kind === 'switch_mode') {
          return this.handlePlanExitPermission(sessionId, adapter, params)
        }

        // Classify ACP tool kind and run through shared permission evaluation
        const category = classifyAcpTool(toolCall.kind)
        const displayName = toolCall.title || toolCall.kind || 'unknown'
        const input = (toolCall.rawInput as Record<string, unknown>) || {}
        const command = category === 'command' && input.command && typeof input.command === 'string'
          ? input.command.trim()
          : null
        const decision = evaluatePermission(category, displayName, command, effectiveAskMode, askAll)

        if (decision.action === 'allow') {
          const optionId = (findOption('allow_once') || findOption('allow_always'))?.optionId || 'allow-once'
          return { outcome: { outcome: 'selected' as const, optionId } }
        }

        if (decision.action === 'deny') {
          const optionId = findOption('reject_once')?.optionId || 'reject-once'
          return { outcome: { outcome: 'selected' as const, optionId }, feedback: decision.message }
        }

        // decision.action === 'prompt' — show permission dialog to user
        const { id: permId, promise } = registerPendingPermission(sessionId)
        this.ctx.broadcaster.send('agent:permission-request', {
          id: permId,
          tool: displayName,
          input,
        }, sessionId)

        const { allowed } = await promise
        const optionId = allowed
          ? (findOption('allow_once') || findOption('allow_always'))?.optionId || 'allow-once'
          : findOption('reject_once')?.optionId || 'reject-once'
        return { outcome: { outcome: 'selected' as const, optionId } }
      }

      // Set extension method handler — dispatches through config registry.
      this.activeExtMethodHandler = async (method: string, params: Record<string, unknown>) => {
        const handler = this.config.extensionHandlers?.[method]
        if (handler) {
          const extContext: AcpExtensionContext = {
            broadcaster: this.ctx.broadcaster,
            registerPendingPermission,
            registerPendingQuestion,
            adapter,
            callbacks,
          }
          return handler(sessionId, params, extContext)
        }
        return {}
      }

      // Notify session identified
      callbacks.onSessionIdentified(sessionId)
      sessionIdentified = true

      // Attach eager title generation now that we have the session ID
      if (eagerTitlePromise) {
        completeTitleGeneration(sessionId, eagerTitlePromise)
      }

      // Emit injected context (triggers draft->session adoption in the renderer)
      const injectedContext = {
        mode: (req.askMode ? 'ask' : req.planMode ? 'plan' : 'code') as 'ask' | 'plan' | 'code',
        ...(contextString ? { systemPrompt: contextString } : {}),
        context: buildContextSummary(contextChunks, docNames.length > 0 ? docNames : undefined),
      }
      callbacks.onMessage({ type: 'injected_context', session_id: sessionId, injectedContext }, sessionId)

      // Persist injected_context and user prompt for reload (agent.ts skips
      // storage for handlesOwnStorage providers, so we write directly)
      this.ctx.sessionStore.appendRawMessage(sessionId, this.id, {
        type: 'injected_context',
        session_id: sessionId,
        injectedContext,
      })
      this.ctx.sessionStore.appendRawMessage(sessionId, this.id, {
        type: 'user',
        session_id: sessionId,
        message: { content: [{ type: 'text', text: cleanedPrompt }] },
      })

      // Send prompt and wait for turn completion
      try {
        await this.acpPrompt(sessionId, contentBlocks)
      } catch (err) {
        const message = extractErrorMessage(err)
        callbacks.onError(`${this.tag} prompt failed${authWarning}: ${message}`, sessionId)
      }

      // Finalize turn — emit accumulated assistant message
      adapter.finalizeTurn()

      // Cleanup
      unsubSessionUpdate()
      this.activePermissionHandler = null
      this.activeExtMethodHandler = null
      this.activeSessions.delete(sessionId)

    } catch (err) {
      const message = extractErrorMessage(err)
      if (!sessionIdentified) {
        if (!sessionId) {
          sessionId = `${this.tag}-failed-${Date.now()}-${Math.random().toString(36).slice(2)}`
        }
        callbacks.onSessionIdentified(sessionId)
        // Emit injected_context to trigger draft->session adoption in renderer
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

        // Log EVERYTHING to per-session file — full raw JSON, no truncation
        logAcpEvent(sessionId, 'session_update', params)

        if (ACP_DEBUG && !['agent_text_chunk', 'agent_thought_chunk'].includes(update.sessionUpdate)) {
          console.log(`[${this.tag}:update]`, update.sessionUpdate, JSON.stringify(params).slice(0, 500))
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
            console.error(`[${this.tag}] Session update handler error:`, err)
          }
        }
      },

      requestPermission: async (params: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
        // Log permission requests to the session file too
        logAcpEvent(params.sessionId || 'unknown', 'permission_request', params)
        if (ACP_DEBUG) console.log(`[${this.tag}:permission]`, JSON.stringify(params).slice(0, 500))

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
        logAcpEvent(params.sessionId as string || 'unknown', 'ext_method', { method, params })
        if (ACP_DEBUG) console.log(`[${this.tag}:ext]`, method, JSON.stringify(params).slice(0, 500))

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
    adapter: AcpStreamAdapter,
    params: RequestPermissionRequest,
  ): Promise<{ outcome: { outcome: 'selected'; optionId: string }; feedback?: string }> {
    const toolCall = params.toolCall

    console.log(`[${this.tag}] switch_mode toolCall:`, JSON.stringify(toolCall, null, 2))

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

    const planEntries = adapter.getPendingPlanEntries()
    const entriesText = planEntries.length > 0
      ? planEntries.map(e => `- [${e.status}] ${e.content}`).join('\n')
      : ''

    const planContent = permissionPlanText || entriesText || 'No plan content available'

    const { id: permId, promise } = registerPendingPermission(sessionId)
    this.ctx.broadcaster.send('agent:permission-request', {
      id: permId,
      tool: 'ExitPlanMode',
      input: { plan: planContent, planContent, planFilePath: `${this.tag}://plan/${sessionId}`, provider: this.id },
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
    if (modelOpt && modelOpt.type === 'select') {
      const flatOptions = flattenSelectOptions(modelOpt.options)
      const match = flatOptions.find(o => o.value === model)
        || flatOptions.find(o => o.value.includes(model) || model.includes(o.value))
      if (match) {
        await this.acpSetConfigOption(sessionId, modelOpt.id, match.value)
      } else {
        console.warn(`[${this.tag}] Model "${model}" not in allowed options [${flatOptions.map(o => o.value).join(', ')}]`)
      }
    }
  }

  /**
   * Set the ACP session mode. Strategy:
   * 1. Try config option (preferred per ACP spec) — look for category: 'mode'
   * 2. Fall back to legacy session/set_mode
   *
   * Different agents use different mode IDs. We try common candidates in order.
   */
  private async applyModeConfig(sessionId: string, req: AgentQueryRequest, result: NewSessionResponse): Promise<void> {
    // Common candidates: agent-specific names first, then ACP spec names
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
        console.log(`[${this.tag}] Setting mode via config option: ${match}`)
        await this.acpSetConfigOption(sessionId, modeOpt.id, match)
        return
      }
      console.warn(`[${this.tag}] No matching mode in config options [${flatOptions.map(o => o.value).join(', ')}]`)
    }

    // 2. Fall back to legacy session/set_mode
    if (result.modes?.availableModes) {
      const match = candidates.find(c => result.modes!.availableModes.some(m => m.id === c))
      if (match) {
        console.log(`[${this.tag}] Setting mode via legacy setSessionMode: ${match}`)
        await this.acpSetSessionMode(sessionId, match)
        return
      }
      console.warn(`[${this.tag}] No matching mode in available modes [${result.modes.availableModes.map(m => m.id).join(', ')}]`)
    }

    console.warn(`[${this.tag}] Could not set mode — tried candidates [${candidates.join(', ')}]`)
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
      throw new Error(`${this.tag} ACP not connected`)
    }
  }

  private processConfigOptions(configOptions: SessionConfigOption[]): void {
    updateModelCacheFromConfigOptions(this.id, configOptions)
    const hasModel = configOptions.some(opt => opt.category === 'model')
    const hasThoughtLevel = configOptions.some(opt => opt.category === 'thought_level')
    updateCapability(this.id, 'model-selection', hasModel)
    updateCapability(this.id, 'reasoning-control', hasThoughtLevel)
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
