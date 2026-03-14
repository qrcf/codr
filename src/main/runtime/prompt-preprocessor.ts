import { readFile } from 'node:fs/promises'
import { resolve, isAbsolute } from 'node:path'
import type { AgentProviderContext } from './provider'

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

export async function retrieveDocsContext(
  ctx: AgentProviderContext,
  searchQuery: string,
  docNames: string[],
): Promise<string> {
  const apiBaseUrl = ctx.relayClient.getApiBaseUrl()
  if (!apiBaseUrl) return ''
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
    if (!res.ok) return ''

    const results = await res.json() as DocSearchResult[]
    if (!results.length) return ''

    const filtered = docNames.length > 0
      ? results.filter(r => docNames.some(name => r.sourceName.toLowerCase() === name.toLowerCase()))
      : results
    if (!filtered.length) return ''

    const chunks = filtered.map(r => {
      const source = `${r.sourceName} (${r.pageUrl})`
      const heading = r.heading ? `## ${r.heading}\n` : ''
      return `--- ${source} ---\n${heading}${r.content}`
    }).join('\n\n')
    return `<documentation_context>\n${chunks}\n</documentation_context>`
  } catch (err) {
    console.error('[docs] Failed to retrieve docs context:', err)
    return ''
  }
}

const MAX_FILE_SIZE = 50 * 1024 // 50KB per file

export async function resolveFileContents(
  filePaths: string[],
  cwd?: string,
): Promise<string> {
  const sections: string[] = []

  for (const filePath of filePaths) {
    const absolutePath = isAbsolute(filePath)
      ? filePath
      : resolve(cwd || process.cwd(), filePath)

    try {
      const content = await readFile(absolutePath, 'utf-8')
      const truncated = content.length > MAX_FILE_SIZE
        ? content.slice(0, MAX_FILE_SIZE) + '\n... (truncated)'
        : content
      sections.push(`--- ${filePath} ---\n${truncated}`)
    } catch {
      // Skip files that don't exist or can't be read
    }
  }

  if (sections.length === 0) return ''
  return `<file_context>\n${sections.join('\n\n')}\n</file_context>`
}

/**
 * Enrich the prompt with relevant codebase context from the LEANN index.
 * Searches the index with the prompt and prepends matching code chunks.
 */
export async function enrichWithCodebaseContext(
  ctx: AgentProviderContext,
  prompt: string,
  cwd?: string,
): Promise<string> {
  if (!ctx.indexerManager || !cwd) return prompt

  try {
    const status = ctx.indexerManager.getStatus()
    if (status.status !== 'ready') return prompt

    const projectStatus = ctx.indexerManager.getProjectStatus(cwd)
    if (projectStatus.status !== 'indexed') return prompt

    const results = await ctx.indexerManager.search(prompt, cwd, 8)
    if (!results.length) return prompt

    const chunks = results.map(r => {
      const score = (r.score * 100).toFixed(0)
      return `--- ${r.path} (${score}% match) ---\n${r.text}`
    }).join('\n\n')

    return `<codebase_context>\nRelevant code from the project index:\n\n${chunks}\n</codebase_context>\n\n${prompt}`
  } catch (err) {
    console.error('[indexer] Failed to enrich prompt with codebase context:', err)
    return prompt
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
): Promise<string> {
  const { cleanedPrompt, docNames } = parseDocRefs(prompt)

  // Enrich with codebase context from LEANN index
  const enriched = await enrichWithCodebaseContext(ctx, docNames.length > 0 ? cleanedPrompt : prompt, cwd)

  if (docNames.length === 0) return enriched

  const docsContext = await retrieveDocsContext(ctx, cleanedPrompt, docNames)
  return docsContext ? `${docsContext}\n\n${enriched}` : enriched
}

/**
 * Preprocess prompt for both docs and file references.
 * Used by Codex provider, which doesn't handle @file natively.
 */
export async function preprocessPromptFull(
  ctx: AgentProviderContext,
  prompt: string,
  cwd?: string,
): Promise<string> {
  const { cleanedPrompt: afterDocs, docNames } = parseDocRefs(prompt)
  const { cleanedPrompt: afterFiles, filePaths } = parseFileRefs(afterDocs)

  const parts: string[] = []

  // Enrich with codebase context from LEANN index
  const codebaseContext = await enrichWithCodebaseContext(ctx, afterFiles, cwd)
  if (codebaseContext !== afterFiles) {
    // Extract the XML block that was prepended
    const xmlEnd = codebaseContext.indexOf('</codebase_context>')
    if (xmlEnd !== -1) {
      parts.push(codebaseContext.slice(0, xmlEnd + '</codebase_context>'.length))
    }
  }

  if (docNames.length > 0) {
    const docsContext = await retrieveDocsContext(ctx, afterFiles, docNames)
    if (docsContext) parts.push(docsContext)
  }

  if (filePaths.length > 0) {
    const fileContext = await resolveFileContents(filePaths, cwd)
    if (fileContext) parts.push(fileContext)
  }

  parts.push(afterFiles)
  return parts.join('\n\n')
}
