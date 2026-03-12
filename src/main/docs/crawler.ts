import * as cheerio from 'cheerio'
import robotsParser from 'robots-parser'

export interface CrawledPage {
  url: string
  html: string
}

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export interface CrawlProgress {
  sourceId: number
  status: 'crawling' | 'complete' | 'error'
  pagesCrawled: number
  currentUrl?: string
  error?: string
}

interface CrawlOptions {
  baseUrl: string
  maxDepth: number
  maxPages: number
  prefix?: string
  concurrency?: number
  delayMs?: number
  signal?: AbortSignal
  onProgress?: (progress: Omit<CrawlProgress, 'sourceId'>) => void
  onPage?: (page: CrawledPage) => Promise<void>
}

/**
 * Build browser-like headers to avoid bot detection.
 * Includes Sec-Fetch-* headers and a dynamic Referer.
 */
function getBrowserHeaders(referer?: string): Record<string, string> {
  return {
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'DNT': '1',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': referer ? 'same-origin' : 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
    ...(referer ? { 'Referer': referer } : {}),
  }
}

/**
 * Normalize a URL by removing fragments and trailing slashes
 */
function normalizeUrl(url: string, base: string): string | null {
  try {
    const parsed = new URL(url, base)
    // Remove fragment
    parsed.hash = ''
    // Remove trailing slash (except for root)
    let normalized = parsed.href
    if (normalized.endsWith('/') && parsed.pathname !== '/') {
      normalized = normalized.slice(0, -1)
    }
    return normalized
  } catch {
    return null
  }
}

/**
 * Check if a URL belongs to the same domain as the base URL
 */
function isSameDomain(url: string, baseUrl: string): boolean {
  try {
    const a = new URL(url)
    const b = new URL(baseUrl)
    return a.hostname === b.hostname
  } catch {
    return false
  }
}

/**
 * Extract internal links from HTML, optionally filtered by prefix
 */
function extractLinks(html: string, pageUrl: string, baseUrl: string, prefix?: string): string[] {
  const $ = cheerio.load(html)
  const links: string[] = []

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')
    if (!href) return

    // Skip non-http links
    if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return

    const normalized = normalizeUrl(href, pageUrl)
    if (normalized && isSameDomain(normalized, baseUrl) && (!prefix || normalized.startsWith(prefix))) {
      links.push(normalized)
    }
  })

  return [...new Set(links)]
}

/**
 * Fetch and parse robots.txt for a domain
 */
async function fetchRobotsTxt(baseUrl: string): Promise<ReturnType<typeof robotsParser> | null> {
  try {
    const robotsUrl = new URL('/robots.txt', baseUrl).href
    const res = await fetch(robotsUrl, {
      signal: AbortSignal.timeout(5000),
      headers: getBrowserHeaders(),
    })
    if (!res.ok) return null
    const text = await res.text()
    return robotsParser(robotsUrl, text)
  } catch {
    return null
  }
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Queue item: [url, depth, referer]
type QueueItem = [string, number, string | undefined]

/**
 * Crawl a documentation site starting from a base URL.
 * Uses concurrent BFS with depth tracking, rate limiting, robots.txt compliance,
 * and optional URL prefix scoping.
 */
export async function crawlSite(options: CrawlOptions): Promise<CrawledPage[]> {
  const {
    baseUrl,
    maxDepth,
    maxPages,
    prefix,
    concurrency = 5,
    delayMs = 200,
    onProgress,
    onPage,
    signal,
  } = options

  // Fetch robots.txt
  const robots = await fetchRobotsTxt(baseUrl)

  const visited = new Set<string>()
  const pages: CrawledPage[] = []

  // BFS queue: [url, depth, referer]
  const queue: QueueItem[] = []
  const normalizedBase = normalizeUrl(baseUrl, baseUrl)
  if (!normalizedBase) throw new Error(`Invalid base URL: ${baseUrl}`)

  queue.push([normalizedBase, 0, undefined])
  visited.add(normalizedBase)

  // Track in-flight requests for proper termination
  let inFlight = 0

  async function worker(): Promise<void> {
    while (true) {
      if (signal?.aborted) break
      if (pages.length >= maxPages) break

      // Grab next item from queue
      const item = queue.shift()
      if (!item) {
        // Queue empty — check if other workers might add more
        if (inFlight === 0) break
        await sleep(50)
        continue
      }

      const [url, depth, referer] = item
      inFlight++

      try {
        // Check robots.txt
        if (robots && !robots.isAllowed(url, '*')) {
          continue
        }

        // Check if we already have enough pages (another worker may have filled quota)
        if (pages.length >= maxPages) break

        onProgress?.({
          status: 'crawling',
          pagesCrawled: pages.length,
          currentUrl: url,
        })

        const res = await fetch(url, {
          signal: signal ?? AbortSignal.timeout(10000),
          headers: getBrowserHeaders(referer),
        })

        if (!res.ok) continue

        const contentType = res.headers.get('content-type') || ''
        if (!contentType.includes('text/html')) continue

        const html = await res.text()
        const page = { url, html }
        pages.push(page)

        // Process page immediately if callback provided
        if (onPage) {
          await onPage(page)
        }

        // Extract and queue links if we haven't reached max depth
        if (depth < maxDepth) {
          const links = extractLinks(html, url, baseUrl, prefix)
          for (const link of links) {
            if (!visited.has(link)) {
              visited.add(link)
              queue.push([link, depth + 1, url])
            }
          }
        }

        // Rate limit per worker
        await sleep(delayMs)
      } catch (err) {
        if (signal?.aborted) break
        console.error(`[crawler] Failed to fetch ${url}:`, err instanceof Error ? err.message : err)
        continue
      } finally {
        inFlight--
      }
    }
  }

  // Launch concurrent workers
  const workers = Array.from({ length: concurrency }, () => worker())
  await Promise.all(workers)

  onProgress?.({
    status: 'complete',
    pagesCrawled: pages.length,
  })

  return pages
}
