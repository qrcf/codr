import { Crawl4AIBridge } from './crawl4ai-bridge.js'
import { chunkMarkdown } from './chunker.js'
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
  const { apiUrl, getAuthToken, broadcaster } = options

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
    startCrawl(source.id, url, crawlDepth, prefix).catch(err => {
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
  }

  /**
   * Re-crawl a doc source
   */
  async function recrawlSource(sourceId: number, url: string, crawlDepth: number, prefix?: string): Promise<void> {
    // Clear existing chunks
    const deleteRes = await apiFetch(apiUrl, `/api/docs/${sourceId}/chunks`, await getToken(), {
      method: 'DELETE',
    })
    if (!deleteRes.ok) throw new Error(`Failed to clear chunks: ${deleteRes.status}`)

    // Start new crawl
    await startCrawl(sourceId, url, crawlDepth, prefix)
  }

  /**
   * Start a crawl job for a source using Crawl4AI
   */
  async function startCrawl(sourceId: number, baseUrl: string, maxDepth: number, prefix?: string): Promise<void> {
    if (activeCrawls.has(sourceId)) {
      console.warn(`[docs] Crawl already active for source ${sourceId}`)
      return
    }

    const bridge = new Crawl4AIBridge()
    activeCrawls.set(sourceId, bridge)
    console.log(`[docs] Starting crawl for source ${sourceId}: ${baseUrl} (depth=${maxDepth})`)

    let pagesCrawled = 0
    let totalChunks = 0

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
      const total = await bridge.crawlSite(baseUrl, maxDepth, 500, prefix || undefined, async (page) => {
        // Chunk the markdown
        const chunked = chunkMarkdown(page.markdown, page.url, page.title)
        const chunkCount = chunked.chunks.length
        console.log(`[docs] Page ${pagesCrawled + 1}: ${page.url} → ${chunkCount} chunks`)

        // Upload chunks to relay (getToken() fetches a fresh Clerk JWT on each call)
        if (chunkCount > 0) {
          const payload = [{
            url: chunked.url,
            title: chunked.title,
            chunks: chunked.chunks.map((c, idx) => ({
              heading: c.heading,
              content: c.content,
              chunkIndex: idx,
            })),
          }]
          const uploadRes = await apiFetch(apiUrl, `/api/docs/${sourceId}/chunks`, await getToken(), {
            method: 'POST',
            body: JSON.stringify({ pages: payload }),
          })
          if (!uploadRes.ok) {
            const body = await uploadRes.text().catch(() => '')
            throw new Error(`Failed to upload page ${page.url}: ${uploadRes.status} ${body}`)
          }
        }

        pagesCrawled++
        totalChunks += chunkCount

        // Broadcast progress after each page
        broadcaster.send('docs:crawl-progress', {
          sourceId,
          status: 'crawling' as const,
          pagesCrawled,
          currentUrl: page.url,
        })
      })

      console.log(`[docs] Crawl fetched ${total} pages from ${baseUrl}`)

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

      console.log(`[docs] Crawl complete for source ${sourceId}: ${pagesCrawled} pages, ${totalChunks} chunks`)
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
   * Search docs via relay
   */
  async function searchDocs(query: string, sourceIds?: number[], limit?: number) {
    const res = await apiFetch(apiUrl, '/api/docs/search', await getToken(), {
      method: 'POST',
      body: JSON.stringify({ query, sourceIds, limit }),
    })
    if (!res.ok) throw new Error(`Doc search failed: ${res.status}`)
    return res.json()
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
    searchDocs,
  }
}

export type DocsManager = ReturnType<typeof createDocsManager>
