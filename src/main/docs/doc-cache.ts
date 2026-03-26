import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// -- Types --

export interface CachedPage {
  id: number
  sourceId: number
  sourceName: string
  url: string
  title: string | null
  markdown: string
  contentHash: string
  headingsJson: string | null
  crawledAt: number
}

export interface PageTOCEntry {
  url: string
  title: string | null
  headings: string[]
}

export interface SourceTOC {
  sourceId: number
  sourceName: string
  sourceUrl: string
  pages: PageTOCEntry[]
}

// -- DB singleton --

let _db: DatabaseSync | null = null

function getDbPath(): string {
  const dir = path.join(app.getPath('userData'), 'docs')
  mkdirSync(dir, { recursive: true })
  return path.join(dir, 'doc-cache.db')
}

function getDb(): DatabaseSync {
  if (_db) return _db

  _db = new DatabaseSync(getDbPath())

  _db.exec(`
    CREATE TABLE IF NOT EXISTS doc_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sourceId INTEGER NOT NULL,
      sourceName TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT,
      markdown TEXT NOT NULL,
      contentHash TEXT NOT NULL,
      headingsJson TEXT,
      crawledAt INTEGER NOT NULL,
      UNIQUE(sourceId, url)
    )
  `)
  _db.exec('CREATE INDEX IF NOT EXISTS idx_doc_pages_source ON doc_pages(sourceId)')

  return _db
}

// -- Write mutex (same pattern as session-index.ts) --

let _writeMutex = Promise.resolve()

function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = _writeMutex.then(fn, fn)
  _writeMutex = next.then(() => {}, () => {})
  return next
}

// -- Public API --

/**
 * Initialize the doc cache database. Call once on app startup.
 */
export function initDocCache(): void {
  getDb()
}

/**
 * Insert or update a crawled page. Returns whether the content changed.
 */
export async function upsertPage(
  sourceId: number,
  sourceName: string,
  url: string,
  title: string | null,
  markdown: string,
  contentHash: string,
  headings: string[],
): Promise<{ changed: boolean }> {
  return withWriteLock(async () => {
    const db = getDb()
    const now = Date.now()

    const existing = db.prepare(
      'SELECT contentHash FROM doc_pages WHERE sourceId = ? AND url = ?',
    ).get(sourceId, url) as { contentHash: string } | undefined

    if (existing && existing.contentHash === contentHash) {
      // Content unchanged — update metadata only
      db.prepare(
        'UPDATE doc_pages SET sourceName = ?, title = ?, headingsJson = ?, crawledAt = ? WHERE sourceId = ? AND url = ?',
      ).run(sourceName, title, JSON.stringify(headings), now, sourceId, url)
      return { changed: false }
    }

    // Insert or replace
    db.prepare(
      `INSERT INTO doc_pages (sourceId, sourceName, url, title, markdown, contentHash, headingsJson, crawledAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(sourceId, url) DO UPDATE SET
         sourceName = excluded.sourceName,
         title = excluded.title,
         markdown = excluded.markdown,
         contentHash = excluded.contentHash,
         headingsJson = excluded.headingsJson,
         crawledAt = excluded.crawledAt`,
    ).run(sourceId, sourceName, url, title, markdown, contentHash, JSON.stringify(headings), now)

    return { changed: true }
  })
}

/**
 * Get all pages for a source.
 */
export function getPages(sourceId: number): CachedPage[] {
  const db = getDb()
  return db.prepare('SELECT * FROM doc_pages WHERE sourceId = ? ORDER BY url').all(sourceId) as CachedPage[]
}

/**
 * Get all pages across all sources.
 */
export function getAllPages(): CachedPage[] {
  const db = getDb()
  return db.prepare('SELECT * FROM doc_pages ORDER BY sourceId, url').all() as CachedPage[]
}

/**
 * Get content hashes for all pages in a source (for change detection during crawl).
 */
export function getPageHashes(sourceId: number): Map<string, string> {
  const db = getDb()
  const rows = db.prepare('SELECT url, contentHash FROM doc_pages WHERE sourceId = ?').all(sourceId) as { url: string; contentHash: string }[]
  return new Map(rows.map(r => [r.url, r.contentHash]))
}

/**
 * Delete all pages for a source.
 */
export async function deleteSourcePages(sourceId: number): Promise<void> {
  return withWriteLock(async () => {
    const db = getDb()
    db.prepare('DELETE FROM doc_pages WHERE sourceId = ?').run(sourceId)
  })
}

/**
 * Get structured TOC for a source (for system prompt injection).
 */
export function getSourceTOC(sourceId: number): SourceTOC | null {
  const db = getDb()
  const rows = db.prepare(
    'SELECT url, title, headingsJson, sourceName FROM doc_pages WHERE sourceId = ? ORDER BY url',
  ).all(sourceId) as { url: string; title: string | null; headingsJson: string | null; sourceName: string }[]

  if (!rows.length) return null

  const pages: PageTOCEntry[] = rows.map(r => ({
    url: r.url,
    title: r.title,
    headings: r.headingsJson ? JSON.parse(r.headingsJson) : [],
  }))

  // Derive sourceUrl from pages (first page's URL root)
  const firstUrl = rows[0].url
  let sourceUrl = firstUrl
  try {
    const u = new URL(firstUrl)
    sourceUrl = u.origin
  } catch { /* keep as-is */ }

  return {
    sourceId,
    sourceName: rows[0].sourceName,
    sourceUrl,
    pages,
  }
}

/**
 * Get TOC for a source by name (case-insensitive match).
 */
export function getSourceTOCByName(name: string): SourceTOC | null {
  const db = getDb()
  const row = db.prepare(
    'SELECT DISTINCT sourceId FROM doc_pages WHERE LOWER(sourceName) = LOWER(?) LIMIT 1',
  ).get(name) as { sourceId: number } | undefined

  if (!row) return null
  return getSourceTOC(row.sourceId)
}

/**
 * Get TOCs for all sources.
 */
export function getAllSourceTOCs(): SourceTOC[] {
  const db = getDb()
  const sourceIds = db.prepare(
    'SELECT DISTINCT sourceId FROM doc_pages ORDER BY sourceId',
  ).all() as { sourceId: number }[]

  return sourceIds
    .map(r => getSourceTOC(r.sourceId))
    .filter((t): t is SourceTOC => t !== null)
}

/**
 * Get all distinct source names (for autocomplete / UI).
 */
export function getDocSourceNames(): { sourceId: number; sourceName: string }[] {
  const db = getDb()
  return db.prepare(
    'SELECT DISTINCT sourceId, sourceName FROM doc_pages ORDER BY sourceName',
  ).all() as { sourceId: number; sourceName: string }[]
}

/**
 * Check if any crawled pages exist.
 */
export function hasPages(): boolean {
  const db = getDb()
  const row = db.prepare('SELECT 1 FROM doc_pages LIMIT 1').get()
  return row !== undefined
}

/**
 * Simple text search over crawled pages (fallback when LEANN is unavailable).
 * Searches title and markdown content for all query terms.
 */
export function searchPages(
  query: string,
  sourceNames?: string[],
  limit = 8,
): CachedPage[] {
  const db = getDb()
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []

  const conditions: string[] = []
  const params: (string | number)[] = []

  // Each term must appear in title or markdown
  for (const term of terms) {
    conditions.push('(LOWER(markdown) LIKE ? OR LOWER(COALESCE(title, \'\')) LIKE ?)')
    params.push(`%${term}%`, `%${term}%`)
  }

  // Filter by source names if provided
  if (sourceNames?.length) {
    const placeholders = sourceNames.map(() => '?').join(',')
    conditions.push(`LOWER(sourceName) IN (${placeholders})`)
    params.push(...sourceNames.map(n => n.toLowerCase()))
  }

  const sql = `SELECT * FROM doc_pages WHERE ${conditions.join(' AND ')} LIMIT ?`
  params.push(limit)

  return db.prepare(sql).all(...params) as CachedPage[]
}
