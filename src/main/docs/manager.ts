import { createHash } from 'node:crypto'
import { Crawl4AIBridge } from './crawl4ai-bridge.js'
import { extractHeadings } from './chunker.js'
import { upsertPage, deleteSourcePages } from './doc-cache.js'
import type { DocsIndexer } from './docs-indexer.js'
import type { EventBroadcaster } from '../event-broadcaster.js'
import type { SetupProgress } from './python-runtime.js'

export interface DocSource {
  id: number
  clerkUserId: string
  url: string
  name: string
  status: string
  crawlDepth: number
  prefix: string | null
  pageCount: number
  lastCrawledAt: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

interface DocsManagerOptions {
  apiUrl: string
  getAuthToken: () => Promise<string> | string | null
  broadcaster: EventBroadcaster
  docsIndexer?: DocsIndexer
}

// In-memory map of active crawl source IDs → bridge instance
const activeCrawls = new Map<number, Crawl4AIBridge>()

/**
 * Helper to call API HTTP endpoints with auth
 */
async function apiFetch(
  apiUrl: string,
  path: string,
  token: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
}

export async function fetchPageTitle(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Codr/1.0)' },
    })
    if (!res.ok) return null
    const text = await res.text()
    const match = text.match(/<title[^>]*>([^<]+)<\/title>/i)
    if (!match) return null
    return match[1]
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
      .trim() || null
  } catch {
    return null
  }
}

export function createDocsManager(options: DocsManagerOptions) {
  const { apiUrl, getAuthToken, broadcaster, docsIndexer } = options

  async function getToken(): Promise<string> {
    const token = await getAuthToken()
    if (!token) throw new Error('Not authenticated')
    return token
  }

  /**
   * List all doc sources for the current user
   */
  async function listSources(): Promise<DocSource[]> {
    const res = await apiFetch(apiUrl, '/api/docs', await getToken())
    if (!res.ok) throw new Error(`Failed to list doc sources: ${res.status}`)
    return res.json() as Promise<DocSource[]>
  }

  /**
   * Add a new doc source: creates the record on the relay, then crawls locally
   */
  async function addSource(url: string, name: string, crawlDepth: number = 3, prefix?: string): Promise<DocSource> {
    // 1. Create source record on relay (status=pending)
    const createRes = await apiFetch(apiUrl, '/api/docs', await getToken(), {
      method: 'POST',
      body: JSON.stringify({ url, name, crawlDepth, prefix: prefix || null }),
    })
    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}))
      throw new Error((err as { error?: string }).error || `Failed to create doc source: ${createRes.status}`)
    }
    const source = await createRes.json() as DocSource

    // 2. Start crawl in background (don't await)
    startCrawl(source.id, name, url, crawlDepth, prefix).catch(err => {
      console.error(`[docs] Background crawl failed for source ${source.id}:`, err)
    })

    return source
  }

  /**
   * Remove a doc source
   */
  async function removeSource(sourceId: number): Promise<void> {
    const res = await apiFetch(apiUrl, `/api/docs/${sourceId}`, await getToken(), {
      method: 'DELETE',
    })
    if (!res.ok) throw new Error(`Failed to delete doc source: ${res.status}`)

    // Clean up local cache and re-index
    await deleteSourcePages(sourceId)
    docsIndexer?.removeSource(sourceId).catch(err => {
      console.error(`[docs] Failed to remove source ${sourceId} from index:`, err)
    })
  }

  /**
   * Re-crawl a doc source
   */
  async function recrawlSource(sourceId: number, name: string, url: string, crawlDepth: number, prefix?: string): Promise<void> {
    // Clear local page cache
    await deleteSourcePages(sourceId)

    // Start new crawl
    await startCrawl(sourceId, name, url, crawlDepth, prefix)
  }

  /**
   * Start a crawl job for a source using Crawl4AI
   */
  async function startCrawl(sourceId: number, sourceName: string, baseUrl: string, maxDepth: number, prefix?: string): Promise<void> {
    if (activeCrawls.has(sourceId)) {
      console.warn(`[docs] Crawl already active for source ${sourceId}`)
      return
    }

    const bridge = new Crawl4AIBridge()
    activeCrawls.set(sourceId, bridge)
    console.log(`[docs] Starting crawl for source ${sourceId}: ${baseUrl} (depth=${maxDepth})`)

    let pagesCrawled = 0

    try {
      // Update status to crawling
      const statusRes = await apiFetch(apiUrl, `/api/docs/${sourceId}`, await getToken(), {
        method: 'PUT',
        body: JSON.stringify({ status: 'crawling' }),
      })
      if (!statusRes.ok) throw new Error(`Failed to update status to crawling: ${statusRes.status}`)

      // Broadcast initial crawling event
      broadcaster.send('docs:crawl-progress', {
        sourceId,
        status: 'crawling' as const,
        pagesCrawled: 0,
        currentUrl: baseUrl,
      })

      // Start bridge with setup progress broadcasting
      const onSetupProgress = (progress: SetupProgress) => {
        broadcaster.send('docs:setup-progress', progress)
      }

      await bridge.start(onSetupProgress)

      // Run the crawl — Crawl4AI handles BFS, link discovery, JS rendering
      console.log(`[docs] Beginning Crawl4AI site crawl: ${baseUrl}`)
      let pagesChanged = 0
      const total = await bridge.crawlSite(baseUrl, maxDepth, 500, prefix || undefined, async (page) => {
        // Compute content hash for deduplication
        const contentHash = createHash('sha256').update(page.markdown).digest('hex').slice(0, 16)

        // Extract heading breadcrumbs for TOC
        const headings = extractHeadings(page.markdown)

        // Cache page locally in SQLite
        const { changed } = await upsertPage(
          sourceId, sourceName, page.url, page.title,
          page.markdown, contentHash, headings,
        )

        if (changed) pagesChanged++
        console.log(`[docs] Page ${pagesCrawled + 1}: ${page.url} (${changed ? 'changed' : 'unchanged'}, ${headings.length} headings)`)

        pagesCrawled++

        // Broadcast progress after each page
        broadcaster.send('docs:crawl-progress', {
          sourceId,
          status: 'crawling' as const,
          pagesCrawled,
          currentUrl: page.url,
        })
      })

      console.log(`[docs] Crawl fetched ${total} pages from ${baseUrl} (${pagesChanged} changed)`)

      // Trigger LEANN re-indexing if any pages changed
      if (pagesChanged > 0 && docsIndexer) {
        console.log(`[docs] Triggering LEANN re-index for source ${sourceId}`)
        await docsIndexer.rebuildAfterCrawl(sourceId).catch(err => {
          console.error(`[docs] LEANN re-index failed for source ${sourceId}:`, err)
        })
      }

      // Update source status to ready
      const readyRes = await apiFetch(apiUrl, `/api/docs/${sourceId}`, await getToken(), {
        method: 'PUT',
        body: JSON.stringify({
          status: 'ready',
          pageCount: pagesCrawled,
          lastCrawledAt: new Date().toISOString(),
        }),
      })
      if (!readyRes.ok) throw new Error(`Failed to update status to ready: ${readyRes.status}`)

      broadcaster.send('docs:crawl-progress', {
        sourceId,
        status: 'complete' as const,
        pagesCrawled,
      })

      console.log(`[docs] Crawl complete for source ${sourceId}: ${pagesCrawled} pages (${pagesChanged} changed)`)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'

      // If the bridge was killed (abort), treat as cancellation
      if (errorMessage === 'Crawl aborted' || errorMessage.includes('Worker killed')) {
        console.log(`[docs] Crawl cancelled for source ${sourceId} after ${pagesCrawled} pages`)
        const finalStatus = pagesCrawled > 0 ? 'ready' : 'pending'
        await apiFetch(apiUrl, `/api/docs/${sourceId}`, await getToken(), {
          method: 'PUT',
          body: JSON.stringify({
            status: finalStatus,
            pageCount: pagesCrawled,
            lastCrawledAt: pagesCrawled > 0 ? new Date().toISOString() : undefined,
          }),
        }).catch(() => {})
        broadcaster.send('docs:crawl-progress', {
          sourceId,
          status: 'complete' as const,
          pagesCrawled,
        })
        return
      }

      console.error(`[docs] Crawl failed for source ${sourceId}:`, errorMessage)

      await apiFetch(apiUrl, `/api/docs/${sourceId}`, await getToken(), {
        method: 'PUT',
        body: JSON.stringify({ status: 'error', errorMessage }),
      }).catch((e) => {
        console.error(`[docs] Failed to set error status for source ${sourceId}:`, e)
      })

      broadcaster.send('docs:crawl-progress', {
        sourceId,
        status: 'error' as const,
        pagesCrawled: 0,
        error: errorMessage,
      })

      throw err
    } finally {
      // Always clean up the bridge
      try { await bridge.stop() } catch { /* ignore */ }
      activeCrawls.delete(sourceId)
    }
  }

  /**
   * Cancel an active crawl
   */
  function cancelCrawl(sourceId: number): boolean {
    const bridge = activeCrawls.get(sourceId)
    if (bridge) {
      console.log(`[docs] Cancelling crawl for source ${sourceId}`)
      bridge.kill()
      return true
    }
    // No active bridge — source may be stuck in 'crawling' from a crashed/restarted session
    console.warn(`[docs] No active crawl for source ${sourceId}, resetting status to pending`)
    getToken().then(token =>
      apiFetch(apiUrl, `/api/docs/${sourceId}`, token, {
        method: 'PUT',
        body: JSON.stringify({ status: 'pending' }),
      })
    ).catch((e) => {
      console.error(`[docs] Failed to reset status for source ${sourceId}:`, e)
    })
    return false
  }

  /**
   * On startup, reset any sources stuck in 'crawling' — they have no active process.
   */
  async function resetStuckCrawls(): Promise<void> {
    try {
      const sources = await listSources()
      const stuck = sources.filter(s => s.status === 'crawling')
      if (stuck.length === 0) return
      console.log(`[docs] Resetting ${stuck.length} stuck crawl(s) to pending on startup`)
      const token = await getToken()
      await Promise.all(stuck.map(async s => {
        await apiFetch(apiUrl, `/api/docs/${s.id}`, token, {
          method: 'PUT',
          body: JSON.stringify({ status: 'pending' }),
        }).catch((e) => {
          console.error(`[docs] Failed to reset source ${s.id}:`, e)
        })
        broadcaster.send('docs:crawl-progress', {
          sourceId: s.id,
          status: 'complete' as const,
          pagesCrawled: 0,
        })
      }))
    } catch (e) {
      console.warn('[docs] Could not reset stuck crawls on startup:', e)
    }
  }

  // Fire-and-forget on creation — resets any sources left in 'crawling' from a prior session
  resetStuckCrawls()

  return {
    listSources,
    addSource,
    removeSource,
    recrawlSource,
    cancelCrawl,
  }
}

export type DocsManager = ReturnType<typeof createDocsManager>
