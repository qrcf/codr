import { readFile } from 'node:fs/promises'
import { resolve, isAbsolute } from 'node:path'
import type { AgentProviderContext } from './provider'
import { getSourceTOCByName, getAllSourceTOCs, type SourceTOC } from '../docs/doc-cache'

export interface ContextChunk {
  type: 'codebase' | 'file'
  source: string
  score?: number
  content: string
}

export interface PreprocessedPrompt {
  prompt: string
  contextChunks: ContextChunk[]
  contextString: string
  /** Doc source names that were referenced via @docs: tokens */
  docNames: string[]
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

export function buildContextSummary(chunks: ContextChunk[], docNames?: string[]): {
  codebase?: { source: string; score?: number }[]
  documentation?: { names: string[] }
  files?: { source: string }[]
} | undefined {
  const codebase = chunks.filter(c => c.type === 'codebase').map(c => ({ source: c.source, score: c.score }))
  const files = chunks.filter(c => c.type === 'file').map(c => ({ source: c.source }))
  const hasDocs = docNames && docNames.length > 0
  if (!codebase.length && !hasDocs && !files.length) return undefined
  return {
    ...(codebase.length ? { codebase } : {}),
    ...(hasDocs ? { documentation: { names: docNames! } } : {}),
    ...(files.length ? { files } : {}),
  }
}

export function serializeContextChunks(chunks: ContextChunk[]): string {
  const groups: Record<string, string[]> = { codebase: [], file: [] }
  for (const c of chunks) {
    const score = c.score != null ? ` (${c.score.toFixed(0)}% match)` : ''
    groups[c.type].push(`--- ${c.source}${score} ---\n${c.content}`)
  }
  const parts: string[] = []
  if (groups.codebase.length) parts.push(`<codebase_context>\nRelevant code from the project index:\n\n${groups.codebase.join('\n\n')}\n</codebase_context>`)
  if (groups.file.length) parts.push(`<file_context>\n${groups.file.join('\n\n')}\n</file_context>`)
  return parts.join('\n\n')
}

// -- Docs TOC injection --

const MAX_TOC_CHARS_PER_SOURCE = 4000

function formatTOC(toc: SourceTOC): string {
  let result = `<docs_toc source="${toc.sourceName}" url="${toc.sourceUrl}">\n`
  let charCount = result.length
  let pageCount = 0

  for (const page of toc.pages) {
    const title = page.title || page.url
    let pageBlock = `- ${title}\n`

    // Include only top-level headings (h1/h2 — those without " > " in the breadcrumb, or with exactly one level)
    const topHeadings = page.headings.filter(h => !h.includes(' > ') || h.split(' > ').length <= 2)
    for (const h of topHeadings) {
      pageBlock += `  - ${h}\n`
    }

    if (charCount + pageBlock.length > MAX_TOC_CHARS_PER_SOURCE) {
      const remaining = toc.pages.length - pageCount
      if (remaining > 0) {
        result += `... and ${remaining} more pages\n`
      }
      break
    }

    result += pageBlock
    charCount += pageBlock.length
    pageCount++
  }

  result += `</docs_toc>`
  return result
}

/**
 * Build a Table of Contents string for referenced doc sources.
 * Injected into the system prompt so the AI knows what docs are available
 * and can search them with the docs_search tool.
 */
export function buildDocsTOC(docNames: string[]): string {
  const tocs: SourceTOC[] = []

  if (docNames.length > 0) {
    for (const name of docNames) {
      const toc = getSourceTOCByName(name)
      if (toc) tocs.push(toc)
    }
  } else {
    tocs.push(...getAllSourceTOCs())
  }

  if (!tocs.length) return ''

  const formatted = tocs.map(formatTOC).join('\n\n')
  return `<documentation_sources>\nThe following documentation sources have been injected into this conversation. To look up details from these docs, use ToolSearch to find the docs_search tool, then search with it. Do NOT search the filesystem for this documentation.\n\n${formatted}\n</documentation_sources>`
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

const CODEBASE_MIN_SCORE = 0.3 // Minimum relevance threshold (0-1)

/**
 * Retrieve codebase context chunks from the LEANN index.
 * Filters out results below the minimum score threshold and
 * any paths the user already referenced via @file.
 */
export async function getCodebaseContextChunks(
  ctx: AgentProviderContext,
  query: string,
  cwd?: string,
  excludePaths?: string[],
): Promise<ContextChunk[]> {
  if (!ctx.indexerManager || !cwd) return []

  try {
    const status = ctx.indexerManager.getStatus()
    if (status.status !== 'ready') return []

    const projectStatus = ctx.indexerManager.getProjectStatus(cwd)
    if (projectStatus.status !== 'indexed') return []

    const results = await ctx.indexerManager.search(query, cwd, 8)
    if (!results.length) return []

    const excludeSet = excludePaths?.length
      ? new Set(excludePaths.map(p => isAbsolute(p) ? p : resolve(cwd, p)))
      : null

    return results
      .filter(r => {
        if (r.score < CODEBASE_MIN_SCORE) return false
        if (excludeSet) {
          const absPath = isAbsolute(r.path) ? r.path : resolve(cwd, r.path)
          if (excludeSet.has(absPath)) return false
        }
        return true
      })
      .map(r => ({
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
  opts?: { includeCodebaseContext?: boolean },
): Promise<PreprocessedPrompt> {
  const { cleanedPrompt, docNames } = parseDocRefs(prompt)
  const searchPrompt = docNames.length > 0 ? cleanedPrompt : prompt
  const finalPrompt = docNames.length > 0 ? cleanedPrompt : prompt

  // Parse @file refs so we can exclude them from codebase results (Claude SDK handles them natively)
  const { filePaths: userFiles } = parseFileRefs(searchPrompt)

  const allChunks: ContextChunk[] = []

  if (opts?.includeCodebaseContext !== false) {
    const codebaseChunks = await getCodebaseContextChunks(ctx, searchPrompt, cwd, userFiles)
    allChunks.push(...codebaseChunks)
  }

  return {
    prompt: finalPrompt,
    contextChunks: allChunks,
    contextString: serializeContextChunks(allChunks),
    docNames,
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
  opts?: { includeCodebaseContext?: boolean; filePaths?: string[] },
): Promise<PreprocessedPrompt> {
  const { cleanedPrompt: afterDocs, docNames } = parseDocRefs(prompt)
  const { cleanedPrompt: afterFiles, filePaths: parsedFilePaths } = parseFileRefs(afterDocs)

  // Merge structured file paths from request with any manually typed @file tokens in the prompt
  const seen = new Set(parsedFilePaths)
  const filePaths = [...parsedFilePaths]
  if (opts?.filePaths) {
    for (const fp of opts.filePaths) {
      if (!seen.has(fp)) {
        seen.add(fp)
        filePaths.push(fp)
      }
    }
  }

  const allChunks: ContextChunk[] = []

  if (opts?.includeCodebaseContext !== false) {
    const codebaseChunks = await getCodebaseContextChunks(ctx, afterFiles, cwd, filePaths)
    allChunks.push(...codebaseChunks)
  }

  if (filePaths.length > 0) {
    const fileChunks = await resolveFileContents(filePaths, cwd)
    allChunks.push(...fileChunks)
  }

  return {
    prompt: afterFiles,
    contextChunks: allChunks,
    contextString: serializeContextChunks(allChunks),
    docNames,
  }
}
