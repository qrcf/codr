import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod/v4'
import { app } from 'electron'
import path from 'node:path'
import { createCanUseTool } from '../../permissions'
import { storeSessionMetadata, setCachedAccountInfo } from '../../sessions'
import type {
  AgentProvider,
  AgentProviderContext,
  AgentQueryRequest,
  ProviderRunCallbacks,
  ProviderRunResult,
} from '../provider'
import { preprocessPromptForDocs } from '../prompt-preprocessor'

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
   * Create an SDK MCP server with a codebase_search tool if the indexer is available.
   */
  private createCodebaseSearchServer(cwd?: string) {
    const indexer = this.ctx.indexerManager
    if (!indexer || !cwd) return null

    const status = indexer.getStatus()
    if (status.status !== 'ready') return null

    const projectStatus = indexer.getProjectStatus(cwd)
    if (projectStatus.status !== 'indexed') return null

    return createSdkMcpServer({
      name: 'codebase-search',
      tools: [
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
      ],
    })
  }

  async runQuery(req: AgentQueryRequest, callbacks: ProviderRunCallbacks): Promise<ProviderRunResult> {
    const origin = req.origin ?? 'local'
    let currentKey = req.resumeSessionId || `new-${Date.now()}-${Math.random().toString(36).slice(2)}`
    let capturedSessionId: string | null = req.resumeSessionId || null
    const isNewSession = !req.resumeSessionId
    const stderrChunks: string[] = []

    const canUseTool = createCanUseTool(this.ctx.broadcaster, () => currentKey, req.askMode, origin)
    let finalPrompt = req.askMode
      ? `[ASK MODE] You are in Ask mode. Your job is to ANSWER the user's question — do NOT edit any code, create files, or make changes. Only read, search, and explain. Do not use Edit, Write, or NotebookEdit tools.\n\n${req.prompt}`
      : req.prompt

    finalPrompt = await preprocessPromptForDocs(this.ctx, finalPrompt, req.cwd)

    // Create codebase search MCP server if indexer is available
    const searchServer = this.createCodebaseSearchServer(req.cwd)
    const mcpServers = searchServer ? { 'codebase-search': searchServer } : undefined

    const cliPath = getClaudeCliPath()
    const q = query({
      prompt: finalPrompt,
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
      },
    })

    this.activeQueries.set(currentKey, q)

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
            storeSessionMetadata(capturedSessionId, req.prompt, this.ctx.relayClient, this.ctx.broadcaster, this.ctx.getAuthToken).catch(() => {})
          }
        }
        callbacks.onMessage(message, currentKey)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const stderr = stderrChunks.join('').trim().slice(-500)
      const errorText = stderr ? `${message}\n\n${stderr}` : message
      callbacks.onError(errorText, currentKey)
    } finally {
      this.activeQueries.delete(currentKey)
      callbacks.onDone(currentKey)
      this.ctx.broadcaster.send('sessions:refresh-hint')
    }

    return { queryKey: currentKey }
  }

  async interruptQuery(sessionId?: string): Promise<void> {
    if (sessionId) {
      const q = this.activeQueries.get(sessionId)
      if (q) await q.interrupt()
      return
    }
    for (const q of this.activeQueries.values()) {
      await q.interrupt()
    }
  }
}
