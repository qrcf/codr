import type {
  AgentProvider,
  AgentProviderContext,
  AgentQueryRequest,
  ProviderRunCallbacks,
  ProviderRunResult,
} from '../provider'
import type { Codex, Thread, ThreadEvent, ThreadItem, ThreadOptions } from '@openai/codex-sdk'
import { preprocessPromptFull } from '../prompt-preprocessor'

type CodexModule = { Codex: new (options?: Record<string, unknown>) => InstanceType<typeof Codex> }

async function createCodexInstance(config?: Record<string, unknown>): Promise<InstanceType<typeof Codex>> {
  const mod = await import('@openai/codex-sdk') as unknown as CodexModule
  return new mod.Codex(config ? { config } : undefined)
}

// Item types that map to tool_use / tool_result blocks in the renderer
const TOOL_ITEM_TYPES = new Set(['command_execution', 'file_change', 'mcp_tool_call', 'web_search'])

function itemToolName(item: ThreadItem): string {
  switch (item.type) {
    case 'command_execution': return 'exec_command'
    case 'file_change': return 'apply_patch'
    case 'mcp_tool_call': return `${item.server}/${item.tool}`
    case 'web_search': return 'web_search'
    default: return item.type
  }
}

function itemToolInput(item: ThreadItem): Record<string, unknown> {
  switch (item.type) {
    case 'command_execution': return { command: item.command }
    case 'file_change': return { changes: item.changes }
    case 'mcp_tool_call': return { arguments: item.arguments }
    case 'web_search': return { query: item.query }
    default: return {}
  }
}

function itemToolResult(item: ThreadItem): string {
  switch (item.type) {
    case 'command_execution': return item.aggregated_output || ''
    case 'file_change': return item.changes.map(c => `${c.kind}: ${c.path}`).join('\n')
    case 'mcp_tool_call': {
      if (item.error) return `Error: ${item.error.message}`
      return item.result ? JSON.stringify(item.result.content) : ''
    }
    default: return ''
  }
}

function itemToolIsError(item: ThreadItem): boolean {
  switch (item.type) {
    case 'command_execution': return item.exit_code !== undefined && item.exit_code !== 0
    case 'mcp_tool_call': return !!item.error
    default: return false
  }
}

/** Map Codex todo_list items to Claude TodoWrite format for the renderer */
function mapTodoListToTodoWrite(item: ThreadItem): Record<string, unknown> {
  if (item.type !== 'todo_list') return {}
  return {
    todos: item.items.map(todo => ({
      content: todo.text,
      status: todo.completed ? 'completed' : 'pending',
      activeForm: todo.text,
    })),
  }
}

export class CodexProvider implements AgentProvider {
  readonly id = 'codex' as const
  private readonly abortControllers = new Map<string, AbortController>()
  private readonly ctx: AgentProviderContext

  constructor(ctx: AgentProviderContext) {
    this.ctx = ctx
  }

  async runQuery(req: AgentQueryRequest, callbacks: ProviderRunCallbacks): Promise<ProviderRunResult> {
    const codex = await createCodexInstance(
      req.planMode ? { include_plan_tool: true } : undefined
    )

    const isResume = !!req.resumeSessionId
    let sessionId = req.resumeSessionId || ''

    const controller = new AbortController()

    const CODEX_REASONING_MAP = { low: 'low', medium: 'medium', high: 'high' } as const
    const threadOptions: ThreadOptions = {
      ...(req.cwd ? { workingDirectory: req.cwd } : {}),
      ...(req.model ? { model: req.model } : {}),
      ...(req.thinkingBudget ? { modelReasoningEffort: CODEX_REASONING_MAP[req.thinkingBudget] } : {}),
    }

    const thread: Thread = isResume
      ? codex.resumeThread(sessionId, threadOptions)
      : codex.startThread(threadOptions)

    let prompt = req.prompt

    // Append mode instructions after the user's prompt so they don't pollute
    // the prompt text used for title generation by the Codex SDK.
    if (req.askMode) {
      prompt = `${prompt}\n\n<system_instruction>You are in ask mode. Answer the question without making edits or executing side effects. Only read, search, and explain.</system_instruction>`
    }
    if (req.planMode) {
      prompt = `${prompt}\n\n<system_instruction>You are in plan mode. Explore the codebase and create an implementation plan. Do not edit source code — only read, search, and plan. You may write plan files to .claude/plans/ directory. When your plan is ready, call ExitPlanMode.</system_instruction>`
    }

    // Resolve @docs: references and @file references into context blocks
    prompt = await preprocessPromptFull(this.ctx, prompt, req.cwd)

    // For resumed sessions we know the ID upfront; emit setup immediately
    if (isResume) {
      this.abortControllers.set(sessionId, controller)
      callbacks.onSessionIdentified(sessionId)
      callbacks.onMessage({
        type: 'user',
        session_id: sessionId,
        message: { content: [{ type: 'text', text: req.prompt }] },
      }, sessionId)
    }

    // Per-turn accumulation state
    let agentText = ''
    const toolUseBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = []
    const toolResultBlocks: Array<{ tool_use_id: string; content: string; is_error: boolean }> = []
    const prevItemTextLen = new Map<string, number>()

    try {
      const { events } = await thread.runStreamed(prompt, { signal: controller.signal })

      for await (const event of events as AsyncIterable<ThreadEvent>) {
        switch (event.type) {
          case 'thread.started': {
            if (!isResume) {
              // New thread — we now have the real Codex thread UUID
              sessionId = event.thread_id
              this.abortControllers.set(sessionId, controller)
              callbacks.onSessionIdentified(sessionId)
              // Emit and index the user's original (un-prefixed) prompt
              callbacks.onMessage({
                type: 'user',
                session_id: sessionId,
                message: { content: [{ type: 'text', text: req.prompt }] },
              }, sessionId)
            }
            // For resumes, thread.started may fire with the same ID — no-op
            break
          }

          case 'item.started':
          case 'item.updated': {
            const item = event.item
            const prevLen = prevItemTextLen.get(item.id) ?? 0

            if (item.type === 'agent_message') {
              const delta = item.text.slice(prevLen)
              if (delta) {
                callbacks.onMessage({
                  type: 'stream_event',
                  session_id: sessionId,
                  event: { type: 'content_block_delta', delta: { type: 'text_delta', text: delta } },
                }, sessionId)
                prevItemTextLen.set(item.id, item.text.length)
              }
              agentText = item.text
            } else if (item.type === 'reasoning') {
              const delta = item.text.slice(prevLen)
              if (delta) {
                callbacks.onMessage({
                  type: 'stream_event',
                  session_id: sessionId,
                  event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: delta } },
                }, sessionId)
                prevItemTextLen.set(item.id, item.text.length)
              }
            } else if (item.type === 'todo_list') {
              // Emit todo_list as a TodoWrite tool_use so the renderer displays it
              const input = mapTodoListToTodoWrite(item)
              callbacks.onMessage({
                type: 'stream_event',
                session_id: sessionId,
                event: {
                  type: 'content_block_start',
                  content_block: { type: 'tool_use', id: item.id, name: 'TodoWrite' },
                },
              }, sessionId)
              callbacks.onMessage({
                type: 'assistant',
                session_id: sessionId,
                message: { content: [{ type: 'tool_use', id: item.id, name: 'TodoWrite', input }] },
              }, sessionId)
            } else if (TOOL_ITEM_TYPES.has(item.type) && event.type === 'item.started') {
              // Announce the tool call to the renderer for live display
              callbacks.onMessage({
                type: 'stream_event',
                session_id: sessionId,
                event: {
                  type: 'content_block_start',
                  content_block: { type: 'tool_use', id: item.id, name: itemToolName(item) },
                },
              }, sessionId)
            }
            break
          }

          case 'item.completed': {
            const item = event.item

            if (item.type === 'agent_message') {
              agentText = item.text
            } else if (item.type === 'todo_list') {
              // Emit final todo_list state
              const input = mapTodoListToTodoWrite(item)
              callbacks.onMessage({
                type: 'assistant',
                session_id: sessionId,
                message: { content: [{ type: 'tool_use', id: item.id, name: 'TodoWrite', input }] },
              }, sessionId)
              callbacks.onMessage({
                type: 'user',
                session_id: sessionId,
                message: {
                  content: [{ type: 'tool_result', tool_use_id: item.id, content: 'Plan updated', is_error: false }],
                },
              }, sessionId)
            } else if (TOOL_ITEM_TYPES.has(item.type)) {
              const name = itemToolName(item)
              const input = itemToolInput(item)
              const result = itemToolResult(item)
              const isError = itemToolIsError(item)

              toolUseBlocks.push({ id: item.id, name, input })
              toolResultBlocks.push({ tool_use_id: item.id, content: result, is_error: isError })

              // Update the renderer's live tool display with full input + result
              callbacks.onMessage({
                type: 'assistant',
                session_id: sessionId,
                message: { content: [{ type: 'tool_use', id: item.id, name, input }] },
              }, sessionId)
              callbacks.onMessage({
                type: 'user',
                session_id: sessionId,
                message: {
                  content: [{ type: 'tool_result', tool_use_id: item.id, content: result, is_error: isError }],
                },
              }, sessionId)
            }
            break
          }

          case 'turn.completed': {
            const usage = event.usage

            // Emit the canonical assistant message (indexed for session replay)
            const assistantContent: unknown[] = []
            if (agentText) assistantContent.push({ type: 'text', text: agentText })
            for (const block of toolUseBlocks) {
              assistantContent.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input })
            }
            if (assistantContent.length > 0) {
              callbacks.onMessage({
                type: 'assistant',
                session_id: sessionId,
                message: {
                  content: assistantContent,
                  usage: {
                    input_tokens: usage.input_tokens,
                    output_tokens: usage.output_tokens,
                    cache_read_input_tokens: usage.cached_input_tokens,
                    cache_creation_input_tokens: 0,
                  },
                },
              }, sessionId)
            }
            if (toolResultBlocks.length > 0) {
              callbacks.onMessage({
                type: 'user',
                session_id: sessionId,
                message: {
                  content: toolResultBlocks.map(b => ({ type: 'tool_result', ...b })),
                },
              }, sessionId)
            }

            // Reset for any subsequent turn
            agentText = ''
            toolUseBlocks.length = 0
            toolResultBlocks.length = 0
            prevItemTextLen.clear()
            break
          }

          case 'turn.failed': {
            callbacks.onError(event.error.message, sessionId)
            break
          }

          case 'error': {
            callbacks.onError(event.message, sessionId)
            break
          }
        }
      }
    } catch (err) {
      const isAbort = (err as { name?: string }).name === 'AbortError'
      callbacks.onError(isAbort ? 'Interrupted' : (err instanceof Error ? err.message : String(err)), sessionId)
    } finally {
      this.abortControllers.delete(sessionId)
      callbacks.onDone(sessionId)
    }

    return { queryKey: sessionId }
  }

  async interruptQuery(sessionId?: string): Promise<void> {
    if (sessionId) {
      this.abortControllers.get(sessionId)?.abort()
      this.abortControllers.delete(sessionId)
      return
    }
    for (const controller of this.abortControllers.values()) {
      controller.abort()
    }
    this.abortControllers.clear()
  }

  forceCleanupAll(): string[] {
    const sessionIds = [...this.abortControllers.keys()]
    for (const controller of this.abortControllers.values()) {
      try { controller.abort() } catch { /* ignore */ }
    }
    this.abortControllers.clear()
    return sessionIds
  }
}
