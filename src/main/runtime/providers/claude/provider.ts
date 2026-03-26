import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import type { Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod/v4'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import path from 'node:path'
import { createCanUseTool } from '../../../permissions'
import { setCachedAccountInfo, beginTitleGeneration, completeTitleGeneration } from '../../../sessions'
import type {
  AgentProvider,
  AgentProviderContext,
  AgentQueryRequest,
  ProviderRunCallbacks,
  ProviderRunResult,
} from '../../provider'
import { preprocessPromptFull, buildContextSummary, buildDocsTOC } from '../../prompt-preprocessor'
import { readAttachmentAsContentBlock } from '../../../attachments'
import { hasPages, searchPages } from '../../../docs/doc-cache'
import { chunkMarkdown } from '../../../docs/chunker'

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

/**
 * In packaged builds the SDK can't resolve cli.js via import.meta.url because
 * the module lives inside app.asar. Return the unpacked path instead.
 */
export function getClaudeCliPath(): string | undefined {
  if (!app.isPackaged) return undefined
  return path.join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '@anthropic-ai',
    'claude-agent-sdk',
    'cli.js'
  )
}

export class ClaudeProvider implements AgentProvider {
  readonly id = 'claude' as const
  private readonly activeQueries = new Map<string, Query>()
  private readonly ctx: AgentProviderContext

  constructor(ctx: AgentProviderContext) {
    this.ctx = ctx
  }

  /**
   * Create an SDK MCP server with codebase_search and docs_search tools.
   */
  private createToolsServer(cwd?: string) {
    const tools: ReturnType<typeof tool>[] = []

    // Codebase search tool (existing)
    const indexer = this.ctx.indexerManager
    if (indexer && cwd) {
      const status = indexer.getStatus()
      const projectStatus = status.status === 'ready' ? indexer.getProjectStatus(cwd) : null
      if (projectStatus?.status === 'indexed') {
        tools.push(
          tool(
            'codebase_search',
            'Search the project codebase using semantic search. Returns relevant code chunks matching a natural language query. Use this to find files and code related to a concept, feature, or implementation detail.',
            { query: z.string().describe('Natural language search query describing what code to find'), limit: z.number().optional().default(10).describe('Maximum number of results to return (default: 10)') },
            async (args) => {
              try {
                const results = await indexer.search(args.query, cwd, args.limit)
                if (!results.length) {
                  return { content: [{ type: 'text' as const, text: 'No matching code found in the project index.' }] }
                }
                const formatted = results.map(r => {
                  const score = (r.score * 100).toFixed(0)
                  return `--- ${r.path} (${score}% match) ---\n${r.text}`
                }).join('\n\n')
                return { content: [{ type: 'text' as const, text: formatted }] }
              } catch (err) {
                return { content: [{ type: 'text' as const, text: `Search failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true }
              }
            },
            { annotations: { readOnlyHint: true } }
          ),
        )
      }
    }

    // Docs search tool — available whenever crawled pages exist in the doc-cache.
    // Uses LEANN semantic search when available, falls back to text search.
    const docsIndexer = this.ctx.docsIndexer
    if (hasPages()) {
      tools.push(
        tool(
          'docs_search',
          'Search indexed documentation for specific information. Returns relevant doc chunks matching a query. Use this to look up API details, usage examples, or concepts from referenced documentation sources.',
          {
            query: z.string().describe('Search query describing what documentation to find'),
            source: z.string().optional().describe('Name of a specific doc source to search within'),
            limit: z.number().optional().default(8).describe('Maximum number of results (default: 8)'),
          },
          async (args) => {
            try {
              // Try LEANN semantic search first
              if (docsIndexer?.isReady()) {
                const results = await docsIndexer.search(
                  args.query,
                  args.source ? [args.source] : undefined,
                  args.limit,
                )
                if (results.length) {
                  const formatted = results.map(r => {
                    const heading = r.heading ? `## ${r.heading}\n` : ''
                    return `--- ${r.sourceName}: ${r.title || r.url} (${r.url}) ---\n${heading}${r.content}`
                  }).join('\n\n')
                  return { content: [{ type: 'text' as const, text: formatted }] }
                }
              }

              // Fallback: text search over doc-cache
              const pages = searchPages(
                args.query,
                args.source ? [args.source] : undefined,
                args.limit,
              )
              if (!pages.length) {
                return { content: [{ type: 'text' as const, text: 'No matching documentation found.' }] }
              }
              const formatted = pages.map(p => {
                const chunked = chunkMarkdown(p.markdown, p.url, p.title || p.url)
                // Find the most relevant chunk (first one containing a query term)
                const queryTerms = args.query.toLowerCase().split(/\s+/)
                const match = chunked.chunks.find(c =>
                  queryTerms.some(t => c.content.toLowerCase().includes(t)),
                ) || chunked.chunks[0]
                const heading = match?.heading ? `## ${match.heading}\n` : ''
                const content = match?.content || p.markdown.slice(0, 2000)
                return `--- ${p.sourceName}: ${p.title || p.url} (${p.url}) ---\n${heading}${content}`
              }).join('\n\n')
              return { content: [{ type: 'text' as const, text: formatted }] }
            } catch (err) {
              return { content: [{ type: 'text' as const, text: `Docs search failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true }
            }
          },
          { annotations: { readOnlyHint: true } }
        ),
      )
    }

    if (!tools.length) return null
    return createSdkMcpServer({ name: 'codr-tools', tools })
  }

  /**
   * Build a multimodal prompt (AsyncIterable<SDKUserMessage>) when attachments are present.
   */
  private async buildMultimodalPrompt(
    finalPrompt: string,
    req: AgentQueryRequest,
  ): Promise<AsyncIterable<SDKUserMessage>> {
    const contentBlocks: Record<string, unknown>[] = []

    // Add text prompt first
    if (finalPrompt) {
      contentBlocks.push({ type: 'text', text: finalPrompt })
    }

    // Add attachment content blocks
    for (const att of req.attachments!) {
      try {
        const block = await readAttachmentAsContentBlock(att)
        contentBlocks.push(block)
      } catch {
        // Skip failed attachments, add a text note instead
        contentBlocks.push({
          type: 'text',
          text: `[Failed to read attachment: ${att.originalName}]`,
        })
      }
    }

    const userMessage = {
      type: 'user' as const,
      message: { role: 'user' as const, content: contentBlocks },
      parent_tool_use_id: null,
      session_id: req.resumeSessionId || '',
      uuid: randomUUID(),
    } as SDKUserMessage

    return (async function* () {
      yield userMessage
    })()
  }

  async runQuery(req: AgentQueryRequest, callbacks: ProviderRunCallbacks): Promise<ProviderRunResult> {
    const origin = req.origin ?? 'local'
    let currentKey = req.resumeSessionId || `new-${Date.now()}-${Math.random().toString(36).slice(2)}`
    let capturedSessionId: string | null = req.resumeSessionId || null
    const isNewSession = !req.resumeSessionId
    const stderrChunks: string[] = []

    const canUseTool = createCanUseTool(this.ctx.broadcaster, () => currentKey, req.askMode, origin)
    let finalPrompt = req.prompt

    const modeInstruction = req.askMode
      ? '[ASK MODE] You are in Ask mode. Your job is to ANSWER the user\'s question — do NOT edit any code, create files, or make changes. Only read, search, and explain. Do not use Edit, Write, or NotebookEdit tools.'
      : ''

    // Kick off title generation as early as possible from the raw user prompt.
    // We publish this back against the draft/new query key so renderer can
    // show a generated title before real session ID adoption.
    const eagerTitlePromise = isNewSession ? beginTitleGeneration(req.prompt) : null
    if (eagerTitlePromise) {
      void eagerTitlePromise.then((title) => {
        const normalized = title.trim()
        if (!normalized) return
        this.ctx.broadcaster.send('agent:draft-title-generated', { title: normalized }, currentKey)
      })
    }

    const { prompt: cleanedPrompt, contextChunks, contextString, docNames: parsedDocNames } = await preprocessPromptFull(this.ctx, finalPrompt, req.cwd, { includeCodebaseContext: isNewSession, filePaths: req.filePaths })
    finalPrompt = cleanedPrompt

    // Merge structured docNames from request with any manually typed @docs: tokens in the prompt
    const docNames = mergeDocNames(req.docNames, parsedDocNames)

    // Build docs TOC if doc sources were referenced
    const docsTOC = docNames.length > 0 ? buildDocsTOC(docNames) : ''

    // Create MCP server with codebase_search and docs_search tools
    const toolsServer = this.createToolsServer(req.cwd)
    const mcpServers = toolsServer ? { 'codr-tools': toolsServer } : undefined

    // Build prompt: multimodal (AsyncIterable<SDKUserMessage>) if attachments, string otherwise
    const hasAttachments = req.attachments && req.attachments.length > 0
    const sdkPrompt: string | AsyncIterable<SDKUserMessage> = hasAttachments
      ? await this.buildMultimodalPrompt(finalPrompt, req)
      : finalPrompt

    // Combine mode instructions, context, and docs TOC into the system prompt append
    const systemAppendParts = [modeInstruction, contextString, docsTOC].filter(Boolean).join('\n\n')

    const cliPath = getClaudeCliPath()
    const q = query({
      prompt: sdkPrompt,
      options: {
        includePartialMessages: true,
        canUseTool,
        stderr: (data) => stderrChunks.push(data),
        ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
        ...(req.resumeSessionId ? { resume: req.resumeSessionId } : {}),
        ...(req.planMode ? { permissionMode: 'plan' as const } : {}),
        ...(req.cwd ? { cwd: req.cwd } : {}),
        ...(req.model ? { model: req.model } : {}),
        ...(req.thinkingBudget ? { thinking: { type: 'enabled' as const, budgetTokens: { low: 3000, medium: 8000, high: 20000 }[req.thinkingBudget] } } : {}),
        ...(mcpServers ? { mcpServers } : {}),
        ...(systemAppendParts ? { systemPrompt: { type: 'preset' as const, preset: 'claude_code' as const, append: systemAppendParts } } : {}),
      },
    })

    const injectedContext = {
      mode: (req.askMode ? 'ask' : req.planMode ? 'plan' : 'code') as 'ask' | 'plan' | 'code',
      ...(systemAppendParts ? { systemPrompt: { preset: 'claude_code', append: systemAppendParts } } : {}),
      context: buildContextSummary(contextChunks, docNames.length > 0 ? docNames : undefined),
    }
    let injectedContextEmitted = false
    if (!isNewSession) {
      callbacks.onMessage({ type: 'injected_context', session_id: '', injectedContext }, currentKey)
      injectedContextEmitted = true
    }

    this.activeQueries.set(currentKey, q)

    // For resumed sessions, fire onSessionIdentified immediately so the user
    // prompt gets indexed. The iterator's guard (!capturedSessionId) won't fire
    // for resumes since capturedSessionId is already set.
    if (!isNewSession && capturedSessionId) {
      callbacks.onSessionIdentified(capturedSessionId)
    }

    // Emit known Claude slash commands so the renderer can show them
    const emitClaudeCommands = (sessionId: string) => {
      callbacks.onMessage({
        type: 'available_commands',
        session_id: sessionId,
        commands: [
          { name: 'compact', description: 'Summarize conversation history to free up context' },
        ],
        provider: 'claude',
      }, sessionId)
    }
    if (capturedSessionId) emitClaudeCommands(capturedSessionId)

    q.accountInfo?.().then((info) => {
      if (!info) return
      setCachedAccountInfo(info)
      callbacks.onAccountInfo?.(info)
    }).catch(() => {})

    try {
      for await (const message of q) {
        if (!capturedSessionId && (message as { session_id?: string }).session_id) {
          capturedSessionId = (message as { session_id?: string }).session_id!
          this.activeQueries.delete(currentKey)
          currentKey = capturedSessionId
          this.activeQueries.set(currentKey, q)
          callbacks.onSessionIdentified(capturedSessionId)

          if (isNewSession) {
            this.ctx.broadcaster.send('sessions:refresh-hint')
            if (eagerTitlePromise) {
              completeTitleGeneration(capturedSessionId, eagerTitlePromise)
            }
          }

          if (!injectedContextEmitted) {
            callbacks.onMessage({ type: 'injected_context', session_id: capturedSessionId, injectedContext }, currentKey)
            injectedContextEmitted = true
          }

          emitClaudeCommands(capturedSessionId)
        }
        callbacks.onMessage(message, currentKey)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const stderr = stderrChunks.join('').trim().slice(-500)
      const fullError = stderr ? `${message}\n\n${stderr}` : message

      // Detect unrecoverable session errors (e.g. after sleep/wake killed the SDK subprocess)
      const isSessionCorrupt = req.resumeSessionId && /no conversation found|session.*not found/i.test(fullError)
      const errorText = isSessionCorrupt
        ? 'This session can no longer be resumed. Start a new conversation to continue.'
        : fullError
      callbacks.onError(errorText, currentKey)
    } finally {
      this.activeQueries.delete(currentKey)
      callbacks.onDone(currentKey)
      this.ctx.broadcaster.send('sessions:refresh-hint')
    }

    return { queryKey: currentKey }
  }

  async interruptQuery(sessionId?: string): Promise<void> {
    const interrupt = async (q: Query, _key: string) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null
      try {
        const timeout = new Promise<void>((_, reject) =>
          { timeoutId = setTimeout(() => reject(new Error('interrupt timeout')), 5000) },
        )
        await Promise.race([q.interrupt(), timeout])
      } catch {
        // interrupt() didn't resolve in time — force-close the subprocess.
        // runQuery's finally block will handle activeQueries cleanup + onDone.
        try { q.close() } catch { /* ignore */ }
      } finally {
        if (timeoutId) clearTimeout(timeoutId)
      }
    }

    if (sessionId) {
      const q = this.activeQueries.get(sessionId)
      if (q) await interrupt(q, sessionId)
      return
    }
    const entries = [...this.activeQueries.entries()]
    await Promise.allSettled(entries.map(([key, q]) => interrupt(q, key)))
  }

  async forceCleanupAll(): Promise<string[]> {
    const sessionIds = [...this.activeQueries.keys()]
    const entries = [...this.activeQueries.entries()]
    await Promise.allSettled(entries.map(([key, q]) => this.disposeQuery(q, key)))
    return sessionIds
  }

  private async disposeQuery(q: Query, key: string): Promise<void> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    try {
      const timeout = new Promise<void>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('interrupt timeout')), 5000)
      })
      await Promise.race([q.interrupt(), timeout])
    } catch {
      // Ignore teardown failures; close() still gives the SDK a chance to release resources.
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
      try {
        q.close()
      } catch {
        // Ignore close errors during abnormal teardown.
      }
      this.activeQueries.delete(key)
    }
  }
}
