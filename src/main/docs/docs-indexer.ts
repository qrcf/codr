import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { IndexerBridge, type ChunkResult } from '../indexer/bridge.js'
import { chunkMarkdown } from './chunker.js'
import { getAllPages } from './doc-cache.js'
import type { CachedPage } from './doc-cache.js'
import type { IndexerManager } from '../indexer/manager.js'

export interface DocsSearchResult {
  sourceId: number
  sourceName: string
  url: string
  title: string | null
  heading: string | null
  content: string
  score: number
}

// -- Chunk cache for incremental doc index rebuilds --

interface DocChunkCacheEntry {
  contentHash: string
  chunks: ChunkResult[]
}
type DocChunkCache = Record<string, DocChunkCacheEntry> // key: `${sourceId}:${url}`

/** LEANN index prefix — LEANN treats this as a filename prefix, not a directory.
 *  build_index creates: docs-index.index, docs-index.ids.txt, etc. */
function getDocsIndexPrefix(): string {
  return join(app.getPath('userData'), 'docs-index')
}

function getChunkCachePath(): string {
  return join(app.getPath('userData'), 'docs-index-chunks', 'chunk_cache.json')
}

function readChunkCache(): DocChunkCache {
  const cachePath = getChunkCachePath()
  if (!existsSync(cachePath)) return {}
  try {
    return JSON.parse(readFileSync(cachePath, 'utf-8'))
  } catch {
    return {}
  }
}

function writeChunkCache(cache: DocChunkCache): void {
  const dir = join(app.getPath('userData'), 'docs-index-chunks')
  mkdirSync(dir, { recursive: true })
  const cachePath = getChunkCachePath()
  const tmpPath = cachePath + '.tmp'
  writeFileSync(tmpPath, JSON.stringify(cache))
  renameSync(tmpPath, cachePath)
}

/**
 * Convert a cached page into LEANN-compatible chunks.
 */
function pageToChunks(page: CachedPage): ChunkResult[] {
  const chunked = chunkMarkdown(page.markdown, page.url, page.title || page.url)
  return chunked.chunks.map((chunk, idx) => {
    const id = createHash('sha256')
      .update(`${page.sourceId}:${page.url}:${idx}`)
      .digest('hex')
      .slice(0, 16)

    return {
      id,
      text: chunk.content,
      metadata: {
        source_id: page.sourceId,
        source_name: page.sourceName,
        url: page.url,
        title: page.title || page.url,
        heading: chunk.heading,
      },
    }
  })
}

function getVenvPythonPath(): string {
  const envDir = join(app.getPath('userData'), 'python-env')
  if (process.platform === 'win32') {
    return join(envDir, 'venv', 'Scripts', 'python.exe')
  }
  return join(envDir, 'venv', 'bin', 'python')
}

function getWorkerPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'indexer', 'worker.py')
  }
  return join(__dirname, '../../resources/indexer/worker.py')
}

function getModelCacheDir(): string {
  return join(app.getPath('userData'), 'models')
}

export class DocsIndexer {
  private bridge: IndexerBridge | null = null
  private indexerManager: IndexerManager
  private docsInitialized = false

  constructor(indexerManager: IndexerManager) {
    this.indexerManager = indexerManager
  }

  /**
   * Check if the docs indexer is ready to serve searches.
   */
  isReady(): boolean {
    // LEANN must be installed (code indexer manages that)
    if (this.indexerManager.getStatus().status !== 'ready') return false
    // Check if we have a LEANN index on disk (prefix-based files)
    return existsSync(getDocsIndexPrefix() + '.index')
  }

  /**
   * Ensure the bridge is started and docs index is initialized.
   */
  private async ensureBridge(): Promise<IndexerBridge> {
    if (this.indexerManager.getStatus().status !== 'ready') {
      throw new Error('LEANN not installed yet')
    }

    if (!this.bridge || !this.bridge.isReady()) {
      this.bridge = new IndexerBridge()
      // Start with no code index path — we only use docs commands
      await this.bridge.start(getVenvPythonPath(), getWorkerPath(), undefined, getModelCacheDir())
    }

    if (!this.docsInitialized) {
      await this.bridge.docsInit(getDocsIndexPrefix())
      this.docsInitialized = true
    }

    return this.bridge
  }

  /**
   * Rebuild the docs index after a source crawl completes.
   * Uses incremental approach: only re-embeds pages with changed content hashes.
   */
  async rebuildAfterCrawl(_sourceId: number): Promise<void> {
    const bridge = await this.ensureBridge()
    const chunkCache = readChunkCache()

    // Get all pages across all sources (combined index)
    const allPages = getAllPages()
    if (!allPages.length) return

    // Separate into cached (unchanged) and new (needs embedding) chunks
    const cachedChunks: ChunkResult[] = []
    const newChunks: ChunkResult[] = []

    for (const page of allPages) {
      const cacheKey = `${page.sourceId}:${page.url}`
      const cached = chunkCache[cacheKey]

      if (cached && cached.contentHash === page.contentHash) {
        // Unchanged — reuse cached embeddings
        cachedChunks.push(...cached.chunks)
      } else {
        // Changed or new — generate fresh chunks
        const chunks = pageToChunks(page)
        newChunks.push(...chunks)
        // Update cache
        chunkCache[cacheKey] = { contentHash: page.contentHash, chunks }
      }
    }

    // Remove cache entries for pages that no longer exist
    const activeKeys = new Set(allPages.map(p => `${p.sourceId}:${p.url}`))
    for (const key of Object.keys(chunkCache)) {
      if (!activeKeys.has(key)) {
        delete chunkCache[key]
      }
    }

    // Build index from all chunks (cached + new)
    const allChunks = [...cachedChunks, ...newChunks]
    if (allChunks.length > 0) {
      console.log(`[docs-indexer] Building index: ${cachedChunks.length} cached + ${newChunks.length} new chunks`)
      await bridge.docsBuildIndex(allChunks)
    }

    // Persist updated cache
    writeChunkCache(chunkCache)

    console.log(`[docs-indexer] Index rebuilt: ${allChunks.length} total chunks`)
  }

  /**
   * Remove a source from the index and rebuild.
   */
  async removeSource(sourceId: number): Promise<void> {
    const chunkCache = readChunkCache()

    // Remove cache entries for this source
    for (const key of Object.keys(chunkCache)) {
      if (key.startsWith(`${sourceId}:`)) {
        delete chunkCache[key]
      }
    }
    writeChunkCache(chunkCache)

    // Rebuild from remaining cached chunks
    const remainingChunks: ChunkResult[] = []
    for (const entry of Object.values(chunkCache)) {
      remainingChunks.push(...entry.chunks)
    }

    if (remainingChunks.length > 0) {
      const bridge = await this.ensureBridge()
      await bridge.docsBuildIndex(remainingChunks)
      console.log(`[docs-indexer] Index rebuilt after source removal: ${remainingChunks.length} chunks`)
    } else {
      console.log('[docs-indexer] No docs remaining, index cleared')
    }
  }

  /**
   * Full rebuild of all docs.
   */
  async fullRebuild(): Promise<void> {
    const bridge = await this.ensureBridge()
    const allPages = getAllPages()
    if (!allPages.length) return

    const chunkCache: DocChunkCache = {}
    const allChunks: ChunkResult[] = []

    for (const page of allPages) {
      const chunks = pageToChunks(page)
      allChunks.push(...chunks)
      chunkCache[`${page.sourceId}:${page.url}`] = {
        contentHash: page.contentHash,
        chunks,
      }
    }

    console.log(`[docs-indexer] Full rebuild: ${allChunks.length} chunks from ${allPages.length} pages`)
    await bridge.docsBuildIndex(allChunks)
    writeChunkCache(chunkCache)
  }

  /**
   * Search indexed documentation.
   */
  async search(query: string, sourceNames?: string[], limit = 8): Promise<DocsSearchResult[]> {
    const bridge = await this.ensureBridge()

    // Resolve source names to IDs if provided
    let sourceIds: number[] | undefined
    if (sourceNames?.length) {
      const allPages = getAllPages()
      const nameToId = new Map<string, number>()
      for (const p of allPages) {
        nameToId.set(p.sourceName.toLowerCase(), p.sourceId)
      }
      sourceIds = sourceNames
        .map(n => nameToId.get(n.toLowerCase()))
        .filter((id): id is number => id !== undefined)
      if (!sourceIds.length) return [] // No matching sources
    }

    const results = await bridge.docsSearch(query, limit, sourceIds)

    return results.map(r => ({
      sourceId: (r.metadata?.source_id as number) ?? 0,
      sourceName: (r.metadata?.source_name as string) ?? 'Unknown',
      url: (r.metadata?.url as string) ?? '',
      title: (r.metadata?.title as string) ?? null,
      heading: (r.metadata?.heading as string) ?? null,
      content: r.text,
      score: r.score,
    }))
  }

  /**
   * Graceful shutdown.
   */
  async shutdown(): Promise<void> {
    if (this.bridge) {
      await this.bridge.stop().catch(() => {})
      this.bridge = null
      this.docsInitialized = false
    }
  }
}
