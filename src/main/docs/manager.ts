import { crawlSite } from './crawler.js'
import { extractAndChunk } from './chunker.js'
import type { EventBroadcaster } from '../event-broadcaster.js'

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
  relayUrl: string
  getAuthToken: () => string | null
  broadcaster: EventBroadcaster
}

// In-memory map of active crawl source IDs → AbortController
const activeCrawls = new Map<number, AbortController>()

/**
 * Helper to call relay HTTP endpoints with auth
 */
async function relayFetch(
  relayUrl: string,
  path: string,
  token: string,
  options: RequestInit = {}
): Promise<Response> {
  // Convert wss:// or ws:// to https:// or http://
  const httpUrl = relayUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://')
  return fetch(`${httpUrl}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
}

export function createDocsManager(options: DocsManagerOptions) {
  const { relayUrl, getAuthToken, broadcaster } = options

  function getToken(): string {
    const token = getAuthToken()
    if (!token) throw new Error('Not authenticated')
    return token
  }

  /**
   * List all doc sources for the current user
   */
  async function listSources(): Promise<DocSource[]> {
    const res = await relayFetch(relayUrl, '/api/docs', getToken())
    if (!res.ok) throw new Error(`Failed to list doc sources: ${res.status}`)
    return res.json() as Promise<DocSource[]>
  }

  /**
   * Add a new doc source: creates the record on the relay, then crawls locally
   */
  async function addSource(url: string, name: string, crawlDepth: number = 3, prefix?: string): Promise<DocSource> {
    // 1. Create source record on relay (status=pending)
    const createRes = await relayFetch(relayUrl, '/api/docs', getToken(), {
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
    const res = await relayFetch(relayUrl, `/api/docs/${sourceId}`, getToken(), {
      method: 'DELETE',
    })
    if (!res.ok) throw new Error(`Failed to delete doc source: ${res.status}`)
  }

  /**
   * Re-crawl a doc source
   */
  async function recrawlSource(sourceId: number, url: string, crawlDepth: number, prefix?: string): Promise<void> {
    // Clear existing chunks
    const deleteRes = await relayFetch(relayUrl, `/api/docs/${sourceId}/chunks`, getToken(), {
      method: 'DELETE',
    })
    if (!deleteRes.ok) throw new Error(`Failed to clear chunks: ${deleteRes.status}`)

    // Start new crawl
    await startCrawl(sourceId, url, crawlDepth, prefix)
  }

  /**
   * Start a crawl job for a source
   */
  async function startCrawl(sourceId: number, baseUrl: string, maxDepth: number, prefix?: string): Promise<void> {
    if (activeCrawls.has(sourceId)) {
      console.warn(`[docs] Crawl already active for source ${sourceId}`)
      return
    }

    const abortController = new AbortController()
    activeCrawls.set(sourceId, abortController)
    console.log(`[docs] Starting crawl for source ${sourceId}: ${baseUrl} (depth=${maxDepth})`)

    // Track progress incrementally (outside try so catch can access)
    let pagesCrawled = 0
    let totalChunks = 0

    try {
      // Update status to crawling
      console.log(`[docs] Setting status to crawling for source ${sourceId}`)
      const statusRes = await relayFetch(relayUrl, `/api/docs/${sourceId}`, getToken(), {
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

      // Crawl — chunk and upload each page as it arrives
      console.log(`[docs] Beginning site crawl: ${baseUrl}`)
      const pages = await crawlSite({
        baseUrl,
        maxDepth,
        maxPages: 500,
        prefix,
        signal: abortController.signal,
        onPage: async (page) => {
          // Chunk this page
          const chunked = extractAndChunk(page.html, page.url)
          const chunkCount = chunked.chunks.length
          console.log(`[docs] Page ${pagesCrawled + 1}: ${page.url} → ${chunkCount} chunks`)

          // Upload immediately
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
            const uploadRes = await relayFetch(relayUrl, `/api/docs/${sourceId}/chunks`, getToken(), {
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
        },
      })
      console.log(`[docs] Crawl fetched ${pages.length} pages from ${baseUrl}`)

      // Check if cancelled
      if (abortController.signal.aborted) {
        console.log(`[docs] Crawl cancelled for source ${sourceId} after ${pagesCrawled} pages`)
        // Set status to ready with whatever pages we got, or pending if none
        const finalStatus = pagesCrawled > 0 ? 'ready' : 'pending'
        await relayFetch(relayUrl, `/api/docs/${sourceId}`, getToken(), {
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

      if (pages.length === 0) {
        console.warn(`[docs] Crawl returned 0 pages for ${baseUrl}`)
      }

      // Update source status to ready
      const readyRes = await relayFetch(relayUrl, `/api/docs/${sourceId}`, getToken(), {
        method: 'PUT',
        body: JSON.stringify({
          status: 'ready',
          pageCount: pages.length,
          lastCrawledAt: new Date().toISOString(),
        }),
      })
      if (!readyRes.ok) throw new Error(`Failed to update status to ready: ${readyRes.status}`)

      broadcaster.send('docs:crawl-progress', {
        sourceId,
        status: 'complete' as const,
        pagesCrawled: pages.length,
      })

      console.log(`[docs] Crawl complete for source ${sourceId}: ${pages.length} pages, ${totalChunks} chunks`)
    } catch (err) {
      // Abort errors are expected when cancelling — don't treat as failure
      if (abortController.signal.aborted) {
        console.log(`[docs] Crawl cancelled for source ${sourceId}`)
        const finalStatus = pagesCrawled > 0 ? 'ready' : 'pending'
        await relayFetch(relayUrl, `/api/docs/${sourceId}`, getToken(), {
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

      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      console.error(`[docs] Crawl failed for source ${sourceId}:`, errorMessage)

      // Update source status to error (best effort with fresh token)
      await relayFetch(relayUrl, `/api/docs/${sourceId}`, getToken(), {
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
      activeCrawls.delete(sourceId)
    }
  }

  /**
   * Search docs via relay
   */
  async function searchDocs(query: string, sourceIds?: number[], limit?: number) {
    const res = await relayFetch(relayUrl, '/api/docs/search', getToken(), {
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
    const controller = activeCrawls.get(sourceId)
    if (controller) {
      console.log(`[docs] Cancelling crawl for source ${sourceId}`)
      controller.abort()
      return true
    }
    return false
  }

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
