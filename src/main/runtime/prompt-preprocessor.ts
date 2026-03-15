import { readFile } from 'node:fs/promises'
import { resolve, isAbsolute } from 'node:path'
import type { AgentProviderContext } from './provider'

export interface ContextChunk {
  type: 'codebase' | 'documentation' | 'file'
  source: string
  score?: number
  url?: string
  heading?: string
  content: string
}

export interface PreprocessedPrompt {
  prompt: string
  contextChunks: ContextChunk[]
  contextString: string
}

interface DocSearchResult {
  sourceName: string
  sourceUrl: string
  pageUrl: string
  pageTitle: string | null
  heading: string | null
  content: string
}

export function parseDocRefs(prompt: string): { cleanedPrompt: string; docNames: string[] } {
  const docNames: string[] = []
  const cleaned = prompt.replace(/@docs:(\S+)/g, (_, name) => {
    docNames.push(name)
    return ''
  }).trim()
  return { cleanedPrompt: cleaned, docNames }
}

export function parseFileRefs(prompt: string): { cleanedPrompt: string; filePaths: string[] } {
  const filePaths: string[] = []
  // Match @path tokens that look like file paths (contain / or .)
  // but skip @docs: which is handled separately
  const cleaned = prompt.replace(/@(?!docs:)([\w./-]+(?:\/[\w./-]+|\.[\w]+))/g, (_, filePath) => {
    filePaths.push(filePath)
    return ''
  }).trim()
  return { cleanedPrompt: cleaned, filePaths }
}

export function buildContextSummary(chunks: ContextChunk[]): {
  codebase?: { source: string; score?: number }[]
  documentation?: { source: string; url?: string; heading?: string }[]
  files?: { source: string }[]
} | undefined {
  const codebase = chunks.filter(c => c.type === 'codebase').map(c => ({ source: c.source, score: c.score }))
  const documentation = chunks.filter(c => c.type === 'documentation').map(c => ({ source: c.source, url: c.url, heading: c.heading }))
  const files = chunks.filter(c => c.type === 'file').map(c => ({ source: c.source }))
  if (!codebase.length && !documentation.length && !files.length) return undefined
  return {
    ...(codebase.length ? { codebase } : {}),
    ...(documentation.length ? { documentation } : {}),
    ...(files.length ? { files } : {}),
  }
}

export function serializeContextChunks(chunks: ContextChunk[]): string {
  const groups: Record<string, string[]> = { codebase: [], documentation: [], file: [] }
  for (const c of chunks) {
    const score = c.score != null ? ` (${c.score.toFixed(0)}% match)` : ''
    const heading = c.heading ? `## ${c.heading}\n` : ''
    groups[c.type].push(`--- ${c.source}${score} ---\n${heading}${c.content}`)
  }
  const parts: string[] = []
  if (groups.codebase.length) parts.push(`<codebase_context>\nRelevant code from the project index:\n\n${groups.codebase.join('\n\n')}\n</codebase_context>`)
  if (groups.documentation.length) parts.push(`<documentation_context>\n${groups.documentation.join('\n\n')}\n</documentation_context>`)
  if (groups.file.length) parts.push(`<file_context>\n${groups.file.join('\n\n')}\n</file_context>`)
  return parts.join('\n\n')
}

export async function retrieveDocsContext(
  ctx: AgentProviderContext,
  searchQuery: string,
  docNames: string[],
): Promise<ContextChunk[]> {
  const apiBaseUrl = ctx.relayClient.getApiBaseUrl()
  if (!apiBaseUrl) return []
  const token = await ctx.getAuthToken()

  try {
    const res = await fetch(`${apiBaseUrl}/api/docs/search`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: searchQuery,
        limit: 8,
      }),
    })
    if (!res.ok) return []

    const results = await res.json() as DocSearchResult[]
    if (!results.length) return []

    const filtered = docNames.length > 0
      ? results.filter(r => docNames.some(name => r.sourceName.toLowerCase() === name.toLowerCase()))
      : results
    if (!filtered.length) return []

    return filtered.map(r => ({
      type: 'documentation' as const,
      source: `${r.sourceName} (${r.pageUrl})`,
      url: r.pageUrl,
      heading: r.heading || undefined,
      content: r.content,
    }))
  } catch (err) {
    console.error('[docs] Failed to retrieve docs context:', err)
    return []
  }
}

const MAX_FILE_SIZE = 50 * 1024 // 50KB per file

export async function resolveFileContents(
  filePaths: string[],
  cwd?: string,
): Promise<ContextChunk[]> {
  const chunks: ContextChunk[] = []

  for (const filePath of filePaths) {
    const absolutePath = isAbsolute(filePath)
      ? filePath
      : resolve(cwd || process.cwd(), filePath)

    try {
      const content = await readFile(absolutePath, 'utf-8')
      const truncated = content.length > MAX_FILE_SIZE
        ? content.slice(0, MAX_FILE_SIZE) + '\n... (truncated)'
        : content
      chunks.push({ type: 'file', source: filePath, content: truncated })
    } catch {
      // Skip files that don't exist or can't be read
    }
  }

  return chunks
}

/**
 * Retrieve codebase context chunks from the LEANN index.
 */
export async function getCodebaseContextChunks(
  ctx: AgentProviderContext,
  query: string,
  cwd?: string,
): Promise<ContextChunk[]> {
  if (!ctx.indexerManager || !cwd) return []

  try {
    const status = ctx.indexerManager.getStatus()
    if (status.status !== 'ready') return []

    const projectStatus = ctx.indexerManager.getProjectStatus(cwd)
    if (projectStatus.status !== 'indexed') return []

    const results = await ctx.indexerManager.search(query, cwd, 8)
    if (!results.length) return []

    return results.map(r => ({
      type: 'codebase' as const,
      source: r.path,
      score: r.score * 100,
      content: r.text,
    }))
  } catch (err) {
    console.error('[indexer] Failed to enrich prompt with codebase context:', err)
    return []
  }
}

/**
 * Preprocess prompt for docs only. Used by Claude provider,
 * which handles @file references natively via the SDK.
 */
export async function preprocessPromptForDocs(
  ctx: AgentProviderContext,
  prompt: string,
  cwd?: string,
): Promise<PreprocessedPrompt> {
  const { cleanedPrompt, docNames } = parseDocRefs(prompt)
  const searchPrompt = docNames.length > 0 ? cleanedPrompt : prompt
  const finalPrompt = docNames.length > 0 ? cleanedPrompt : prompt

  const allChunks: ContextChunk[] = []

  const codebaseChunks = await getCodebaseContextChunks(ctx, searchPrompt, cwd)
  allChunks.push(...codebaseChunks)

  if (docNames.length > 0) {
    const docChunks = await retrieveDocsContext(ctx, searchPrompt, docNames)
    allChunks.push(...docChunks)
  }

  return {
    prompt: finalPrompt,
    contextChunks: allChunks,
    contextString: serializeContextChunks(allChunks),
  }
}

/**
 * Preprocess prompt for both docs and file references.
 * Used by Codex provider, which doesn't handle @file natively.
 */
export async function preprocessPromptFull(
  ctx: AgentProviderContext,
  prompt: string,
  cwd?: string,
): Promise<PreprocessedPrompt> {
  const { cleanedPrompt: afterDocs, docNames } = parseDocRefs(prompt)
  const { cleanedPrompt: afterFiles, filePaths } = parseFileRefs(afterDocs)

  const allChunks: ContextChunk[] = []

  const codebaseChunks = await getCodebaseContextChunks(ctx, afterFiles, cwd)
  allChunks.push(...codebaseChunks)

  if (docNames.length > 0) {
    const docChunks = await retrieveDocsContext(ctx, afterFiles, docNames)
    allChunks.push(...docChunks)
  }

  if (filePaths.length > 0) {
    const fileChunks = await resolveFileContents(filePaths, cwd)
    allChunks.push(...fileChunks)
  }

  return {
    prompt: afterFiles,
    contextChunks: allChunks,
    contextString: serializeContextChunks(allChunks),
  }
}
