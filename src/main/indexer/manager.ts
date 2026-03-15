import { app } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { createHash } from 'node:crypto'
import { IndexerBridge } from './bridge.js'
import { listFilesData } from '../sessions.js'

// -- Constants --

const LEANN_VERSION = '0.3.7'
const PYTHON_VERSION = '3.12'
const EMBEDDING_MODEL = 'sentence-transformers/all-MiniLM-L6-v2'
const MAX_FILE_SIZE = 50 * 1024 // 50KB

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp', '.bmp',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.zip', '.gz', '.tar', '.7z', '.rar',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.exe', '.dll', '.so', '.dylib', '.o',
  '.mp3', '.mp4', '.wav', '.avi', '.mov',
  '.db', '.sqlite', '.sqlite3',
  '.lock', '.map',
])

const INDEXER_SKIP_FILES = new Set([
  'license', 'licence', 'changelog', 'changelog.md', 'license.md', 'licence.md',
  'yarn.lock', 'pnpm-lock.yaml', 'package-lock.json',
])

function shouldSkipForIndexing(relPath: string): boolean {
  const name = (relPath.split('/').pop() || '').toLowerCase()
  if (name.startsWith('.')) return true
  return INDEXER_SKIP_FILES.has(name);

}

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyw',
  '.go',
  '.rs',
  '.java', '.kt', '.scala',
  '.c', '.cpp', '.cc', '.h', '.hpp',
  '.cs',
  '.rb',
  '.php',
  '.swift',
  '.sh', '.bash', '.zsh',
  '.vue', '.svelte',
])

const NON_CODE_PENALTY = 0.5
const MIN_SCORE = 0.2

export type GlobalIndexerStatus = 'not-ready' | 'setting-up' | 'ready' | 'error'
export type ProjectIndexStatus = 'not-indexed' | 'indexing' | 'indexed' | 'error'

export interface IndexerSetupProgress {
  step: string
  detail?: string
  projectDir?: string
  progress?: { current: number; total: number }
}

export interface FileIndexInfo {
  contentHash: string
  mtime: number
  chunkCount: number
  language: string
  size: number
}

// -- Language detection (for UI display) --

type LanguageId = 'ts' | 'py' | 'go' | 'rs' | 'unknown'

function detectLanguage(filePath: string): LanguageId {
  const ext = extname(filePath).toLowerCase()
  switch (ext) {
    case '.ts': case '.tsx': case '.js': case '.jsx': case '.mjs': case '.cjs':
      return 'ts'
    case '.py': case '.pyw':
      return 'py'
    case '.go':
      return 'go'
    case '.rs':
      return 'rs'
    default:
      return 'unknown'
  }
}

// -- Path helpers --

function getEnvDir(): string {
  return join(app.getPath('userData'), 'python-env')
}

function getUvPath(): string {
  const binary = process.platform === 'win32' ? 'uv.exe' : 'uv'
  if (app.isPackaged) {
    return join(process.resourcesPath, 'bin', binary)
  }
  return binary
}

function getVenvPythonPath(): string {
  if (process.platform === 'win32') {
    return join(getEnvDir(), 'venv', 'Scripts', 'python.exe')
  }
  return join(getEnvDir(), 'venv', 'bin', 'python')
}

function getWorkerPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'indexer', 'worker.py')
  }
  return join(__dirname, '../../resources/indexer/worker.py')
}

function getRequirementsPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'indexer', 'requirements.txt')
  }
  return join(__dirname, '../../resources/indexer/requirements.txt')
}

function getModelCacheDir(): string {
  return join(app.getPath('userData'), 'models')
}

function getIndexerDataDir(): string {
  return join(app.getPath('userData'), 'indexer')
}

function getProjectIndexDir(projectDir: string): string {
  const hash = createHash('sha256').update(projectDir).digest('hex').slice(0, 12)
  return join(getIndexerDataDir(), hash)
}

function getSetupHash(): string {
  return createHash('sha256')
    .update(`${PYTHON_VERSION}-leann-${LEANN_VERSION}-hnsw-${EMBEDDING_MODEL}`)
    .digest('hex')
    .slice(0, 16)
}

function getSetupMarkerPath(): string {
  return join(getEnvDir(), '.indexer-setup-complete')
}

function isSetupComplete(): boolean {
  const markerPath = getSetupMarkerPath()
  if (!existsSync(markerPath)) return false
  try {
    return readFileSync(markerPath, 'utf-8').trim() === getSetupHash()
  } catch {
    return false
  }
}

// -- Metadata for staleness tracking --

interface IndexMetadata {
  files: Record<string, FileIndexInfo>
  builtAt: number
}

function getMetadataPath(projectDir: string): string {
  return join(getProjectIndexDir(projectDir), 'metadata.json')
}

function readMetadata(projectDir: string): IndexMetadata | null {
  const metaPath = getMetadataPath(projectDir)
  if (!existsSync(metaPath)) return null
  try {
    const raw = JSON.parse(readFileSync(metaPath, 'utf-8'))
    // Backwards compat: old metadata used symbolCount, new uses chunkCount
    if (raw.files && typeof raw.files === 'object') {
      const firstVal = Object.values(raw.files)[0]
      if (typeof firstVal === 'number') {
        // Convert old format (Record<string, number>) → new format
        const converted: Record<string, FileIndexInfo> = {}
        for (const [path, mtime] of Object.entries(raw.files)) {
          converted[path] = { contentHash: '', mtime: mtime as number, chunkCount: 0, language: 'unknown', size: 0 }
        }
        return { files: converted, builtAt: raw.builtAt }
      }
      // Convert old symbolCount → chunkCount
      if (firstVal && typeof firstVal === 'object' && 'symbolCount' in (firstVal as object)) {
        const converted: Record<string, FileIndexInfo> = {}
        for (const [path, info] of Object.entries(raw.files)) {
          const old = info as Record<string, unknown>
          converted[path] = {
            contentHash: '',
            mtime: (old.mtime as number) || 0,
            chunkCount: (old.symbolCount as number) || 0,
            language: (old.language as string) || 'unknown',
            size: (old.size as number) || 0,
          }
        }
        return { files: converted, builtAt: raw.builtAt }
      }
    }
    // Migrate entries missing contentHash (added in patch-rebuild update)
    if (raw.files && typeof raw.files === 'object') {
      const firstEntry = Object.values(raw.files)[0] as Record<string, unknown> | undefined
      if (firstEntry && !('contentHash' in firstEntry)) {
        for (const info of Object.values(raw.files) as Record<string, unknown>[]) {
          info.contentHash = ''
        }
      }
    }
    return raw
  } catch {
    return null
  }
}

function writeMetadata(projectDir: string, meta: IndexMetadata): void {
  const dir = getProjectIndexDir(projectDir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(getMetadataPath(projectDir), JSON.stringify(meta))
}

// -- Content hashing --

function computeContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

// -- Chunk cache for patch-based rebuilds --

interface ChunkCacheEntry {
  contentHash: string
  chunks: { id: string; text: string; metadata: Record<string, unknown> }[]
}
type ChunkCache = Record<string, ChunkCacheEntry>

function getChunkCachePath(projectDir: string): string {
  return join(getProjectIndexDir(projectDir), 'chunk_cache.json')
}

function readChunkCache(projectDir: string): ChunkCache {
  const cachePath = getChunkCachePath(projectDir)
  if (!existsSync(cachePath)) return {}
  try {
    return JSON.parse(readFileSync(cachePath, 'utf-8'))
  } catch {
    return {}
  }
}

function writeChunkCache(projectDir: string, cache: ChunkCache): void {
  const dir = getProjectIndexDir(projectDir)
  mkdirSync(dir, { recursive: true })
  const cachePath = getChunkCachePath(projectDir)
  const tmpPath = cachePath + '.tmp'
  writeFileSync(tmpPath, JSON.stringify(cache))
  renameSync(tmpPath, cachePath)
}

// -- File classification for incremental updates --

interface FileClassification {
  unchanged: string[]
  changed: string[]
  added: string[]
  removed: string[]
  /** Content hashes computed during classification (for changed + added files) */
  newHashes: Map<string, string>
  /** Updated mtimes for files whose mtime changed but content didn't */
  updatedMtimes: Map<string, number>
}

async function classifyFiles(
  projectDir: string,
  currentFiles: string[],
  meta: IndexMetadata | null,
  chunkCache: ChunkCache,
): Promise<FileClassification> {
  const result: FileClassification = {
    unchanged: [], changed: [], added: [], removed: [],
    newHashes: new Map(), updatedMtimes: new Map(),
  }

  if (!meta) {
    // No previous metadata — everything is new
    result.added = currentFiles
    return result
  }

  const oldSet = new Set(Object.keys(meta.files))
  const currentSet = new Set(currentFiles)

  // Removed files
  result.removed = [...oldSet].filter(f => !currentSet.has(f))

  for (const file of currentFiles) {
    const oldInfo = meta.files[file]
    if (!oldInfo) {
      // New file
      result.added.push(file)
      continue
    }

    // File exists in both old and new — check if changed
    try {
      const s = await stat(join(projectDir, file))

      // Fast path: mtime unchanged → assume content unchanged
      if (Math.abs(s.mtimeMs - (oldInfo.mtime || 0)) <= 1000 && oldInfo.contentHash) {
        // Also verify cache entry exists and hash matches
        const cached = chunkCache[file]
        if (cached && cached.contentHash === oldInfo.contentHash) {
          result.unchanged.push(file)
          continue
        }
      }

      // Slow path: mtime changed or no contentHash — read and hash content
      const fullPath = join(projectDir, file)
      const content = await readFile(fullPath, 'utf-8')
      const hash = computeContentHash(content)

      if (oldInfo.contentHash && hash === oldInfo.contentHash) {
        // Content unchanged despite mtime change (e.g. git checkout)
        result.unchanged.push(file)
        result.updatedMtimes.set(file, s.mtimeMs)
      } else {
        // Content actually changed
        result.changed.push(file)
        result.newHashes.set(file, hash)
      }
    } catch {
      // Can't read file — treat as removed
      result.removed.push(file)
    }
  }

  return result
}

// -- Shell helper --

function runCommand(cmd: string, args: string[], opts?: { cwd?: string; env?: Record<string, string> }): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: opts?.cwd,
      env: { ...process.env, ...opts?.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    proc.stdout?.on('data', (d) => { stdout += d.toString() })
    proc.stderr?.on('data', (d) => { stderr += d.toString() })
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`Command failed (${code}): ${cmd} ${args.join(' ')}\n${stderr}`))
    })
    proc.on('error', (err) => reject(err))
  })
}

// -- Manager --

export class IndexerManager {
  private bridge: IndexerBridge | null = null
  private globalStatus: GlobalIndexerStatus = 'not-ready'
  private globalError: string | null = null
  private onProgress: ((progress: IndexerSetupProgress) => void) | null = null
  private currentIndexPath: string | null = null
  private indexingProjectDir: string | null = null
  private projectErrors: Record<string, string> = {}

  /**
   * Start background setup. Non-blocking — resolves immediately, setup runs async.
   */
  startSetup(onProgress?: (progress: IndexerSetupProgress) => void): void {
    this.onProgress = onProgress || null
    this.doSetup().catch((err) => {
      console.error('[indexer] Setup failed:', err)
      this.globalStatus = 'error'
      this.globalError = err instanceof Error ? err.message : String(err)
      this.onProgress?.({ step: 'error', detail: this.globalError })
    })
  }

  getStatus(): { status: GlobalIndexerStatus; detail?: string } {
    return {
      status: this.globalStatus,
      detail: this.globalError || undefined,
    }
  }

  getProjectStatus(projectDir: string): { status: ProjectIndexStatus; fileCount?: number; detail?: string } {
    if (!projectDir) return { status: 'not-indexed' }
    if (this.indexingProjectDir === projectDir) return { status: 'indexing' }
    const meta = readMetadata(projectDir)
    if (!meta) {
      const err = this.projectErrors[projectDir]
      return err ? { status: 'error', detail: err } : { status: 'not-indexed' }
    }
    return { status: 'indexed', fileCount: Object.keys(meta.files).length }
  }

  /**
   * Return the list of indexed files with their info for a project.
   */
  getProjectFiles(projectDir: string): { path: string; chunkCount: number; language: string; size: number }[] {
    if (!projectDir) return []
    const meta = readMetadata(projectDir)
    if (!meta) return []
    return Object.entries(meta.files)
      .map(([path, info]) => ({
        path,
        chunkCount: info.chunkCount,
        language: info.language,
        size: info.size,
      }))
      .sort((a, b) => a.path.localeCompare(b.path))
  }

  /**
   * Search the index for a project directory.
   * Returns results with file path, score, and matched code chunk text.
   */
  async search(query: string, projectDir: string, limit = 15): Promise<{ path: string; score: number; text: string }[]> {
    if (!projectDir) throw new Error('projectDir is required')
    if (this.globalStatus !== 'ready') throw new Error('Indexer not installed')

    const indexDir = getProjectIndexDir(projectDir)
    const bridge = await this.ensureBridge(indexDir)

    // Over-fetch to compensate for dedup and filtering
    const results = await bridge.search(query, limit * 3)

    // Score threshold + dedup by path (keep highest score) + code prioritization
    const byPath = new Map<string, { path: string; adjustedScore: number; text: string }>()
    for (const r of results) {
      if (r.score < MIN_SCORE) continue
      const path = (r.metadata?.file_path as string) || r.id
      const ext = extname(path).toLowerCase()
      const isCode = CODE_EXTENSIONS.has(ext)
      const adjustedScore = isCode ? r.score : r.score * NON_CODE_PENALTY

      const existing = byPath.get(path)
      if (!existing || adjustedScore > existing.adjustedScore) {
        byPath.set(path, { path, adjustedScore, text: r.text })
      }
    }

    // Boost/inject filename matches so files literally named after the query aren't missed
    const meta = readMetadata(projectDir)
    if (meta) {
      const queryLower = query.toLowerCase()
      const FILENAME_BOOST = 0.75
      for (const filePath of Object.keys(meta.files)) {
        const fileName = filePath.split('/').pop()?.toLowerCase() || ''
        if (fileName.includes(queryLower)) {
          const existing = byPath.get(filePath)
          if (existing) {
            existing.adjustedScore = Math.max(existing.adjustedScore, FILENAME_BOOST)
          } else {
            byPath.set(filePath, { path: filePath, adjustedScore: FILENAME_BOOST, text: '' })
          }
        }
      }
    }

    return [...byPath.values()]
      .sort((a, b) => b.adjustedScore - a.adjustedScore)
      .slice(0, limit)
      .map(r => ({
        path: r.path,
        score: r.adjustedScore,
        text: r.text,
      }))
  }

  /**
   * Build or rebuild the index for a project.
   * Uses patch-based approach: only re-chunks changed/added files, rebuilds HNSW from cached + new chunks.
   * When force=true, ignores cache and re-chunks everything (used by manual "Rebuild Index" button).
   */
  async buildIndex(projectDir: string, force = false): Promise<void> {
    if (!projectDir) throw new Error('projectDir is required')
    if (this.globalStatus !== 'ready') throw new Error('Indexer not installed')

    this.indexingProjectDir = projectDir
    delete this.projectErrors[projectDir]
    this.onProgress?.({ step: 'indexing', detail: 'Scanning files...', projectDir, progress: { current: 0, total: 0 } })

    try {
      const indexDir = getProjectIndexDir(projectDir)
      mkdirSync(indexDir, { recursive: true })

      const bridge = await this.ensureBridge(indexDir)

      // List files
      const files = await listFilesData(projectDir, 2000)
      const totalFiles = files.length

      // Load existing metadata and chunk cache
      const meta = force ? null : readMetadata(projectDir)
      const chunkCache = force ? {} as ChunkCache : readChunkCache(projectDir)

      // Classify files into unchanged/changed/added/removed
      const classification = await classifyFiles(projectDir, files, meta, chunkCache)
      const { unchanged, changed, added, removed, newHashes, updatedMtimes } = classification

      const filesToProcess = [...changed, ...added]
      const totalChanged = filesToProcess.length + removed.length
      this.onProgress?.({ step: 'indexing', detail: `${totalChanged} file${totalChanged !== 1 ? 's' : ''} changed, reading...`, projectDir, progress: { current: 0, total: totalFiles } })

      // Read ONLY changed + added file contents
      const newFileContents: { path: string; content: string }[] = []
      const contentsByPath = new Map<string, string>()

      for (const filePath of filesToProcess) {
        if (BINARY_EXTENSIONS.has(extname(filePath).toLowerCase())) continue
        if (shouldSkipForIndexing(filePath)) continue
        try {
          const fullPath = join(projectDir, filePath)
          const content = await readFile(fullPath, 'utf-8')
          const truncated = content.length > MAX_FILE_SIZE ? content.slice(0, MAX_FILE_SIZE) : content
          newFileContents.push({ path: filePath, content: truncated })
          contentsByPath.set(filePath, content)
        } catch { /* skip unreadable files */ }
      }

      // Collect cached chunks for unchanged files
      const cachedChunks: { id: string; text: string; metadata: Record<string, unknown> }[] = []
      for (const file of unchanged) {
        const entry = chunkCache[file]
        if (entry?.chunks) {
          cachedChunks.push(...entry.chunks)
        }
      }

      this.onProgress?.({
        step: 'indexing',
        detail: `Chunking ${newFileContents.length} changed file${newFileContents.length !== 1 ? 's' : ''}, rebuilding index with ${cachedChunks.length} cached chunks...`,
        projectDir,
        progress: { current: Math.round(totalFiles * 0.3), total: totalFiles },
      })

      // Patch rebuild: chunk new files + rebuild HNSW from cached + new
      const { count, newChunks } = await bridge.patchRebuild({
        newFiles: newFileContents,
        cachedChunks,
      }, (progress) => {
        let detail: string
        let pct: number
        if (progress.phase === 'chunking') {
          detail = `Chunking files...`; pct = 0.3
        } else if (progress.phase === 'embedding') {
          detail = `Embedding chunks (${progress.current}/${progress.total})...`
          pct = 0.3 + (progress.current / progress.total) * 0.6 // 30% → 90%
        } else if (progress.phase === 'building') {
          detail = 'Building search index...'; pct = 0.92
        } else return

        this.onProgress?.({
          step: 'indexing', detail, projectDir,
          progress: { current: Math.round(totalFiles * pct), total: totalFiles },
        })
      })

      // Update chunk cache: remove old entries, add new ones
      const updatedCache: ChunkCache = {}

      // Keep unchanged entries
      for (const file of unchanged) {
        if (chunkCache[file]) {
          updatedCache[file] = chunkCache[file]
        }
      }

      // Add new entries for changed + added files, grouped by file path
      const chunksByFile = new Map<string, { id: string; text: string; metadata: Record<string, unknown> }[]>()
      for (const chunk of newChunks) {
        const fp = (chunk.metadata?.file_path as string) || ''
        if (!chunksByFile.has(fp)) chunksByFile.set(fp, [])
        chunksByFile.get(fp)!.push(chunk)
      }

      for (const file of filesToProcess) {
        const fileChunks = chunksByFile.get(file) || []
        const content = contentsByPath.get(file)
        const hash = newHashes.get(file) || (content ? computeContentHash(content) : '')
        updatedCache[file] = { contentHash: hash, chunks: fileChunks }
      }

      writeChunkCache(projectDir, updatedCache)

      // Save metadata with per-file info including content hashes
      const chunkCountPerFile = new Map<string, number>()
      for (const chunk of [...cachedChunks, ...newChunks]) {
        const fp = (chunk.metadata?.file_path as string) || ''
        chunkCountPerFile.set(fp, (chunkCountPerFile.get(fp) || 0) + 1)
      }

      const fileInfos: Record<string, FileIndexInfo> = {}
      for (const file of files) {
        try {
          const s = await stat(join(projectDir, file))
          // Use hash from classification if available, otherwise from cache or compute fresh
          let hash = newHashes.get(file) || ''
          if (!hash && updatedCache[file]?.contentHash) {
            hash = updatedCache[file].contentHash
          }
          if (!hash && meta?.files[file]?.contentHash) {
            hash = meta.files[file].contentHash
          }
          const mtime = updatedMtimes.get(file) ?? s.mtimeMs
          fileInfos[file] = {
            contentHash: hash,
            mtime,
            chunkCount: chunkCountPerFile.get(file) || 0,
            language: detectLanguage(file),
            size: s.size,
          }
        } catch { /* skip */ }
      }
      writeMetadata(projectDir, { files: fileInfos, builtAt: Date.now() })

      this.indexingProjectDir = null
      this.onProgress?.({ step: 'indexed', detail: `${count} chunks from ${files.length} files (${filesToProcess.length} re-chunked)`, projectDir })
    } catch (err) {
      this.indexingProjectDir = null
      const detail = err instanceof Error ? err.message : String(err)
      this.projectErrors[projectDir] = detail
      this.onProgress?.({ step: 'error', detail, projectDir })
      throw err
    }
  }

  /**
   * Check if the index is stale and patch-rebuild if needed.
   * Uses content hashes for reliable change detection. Only re-chunks changed files.
   */
  async refreshIfStale(projectDir: string): Promise<void> {
    // Skip if already indexing this project
    if (this.indexingProjectDir === projectDir) return

    const meta = readMetadata(projectDir)
    if (!meta) {
      await this.buildIndex(projectDir)
      return
    }

    const currentFiles = await listFilesData(projectDir, 2000)
    const chunkCache = readChunkCache(projectDir)
    const classification = await classifyFiles(projectDir, currentFiles, meta, chunkCache)

    const totalChanged = classification.changed.length + classification.added.length + classification.removed.length
    if (totalChanged === 0) {
      // No content changes — just update mtimes if any changed
      if (classification.updatedMtimes.size > 0) {
        for (const [file, mtime] of classification.updatedMtimes) {
          if (meta.files[file]) meta.files[file].mtime = mtime
        }
        writeMetadata(projectDir, meta)
      }
      return
    }

    // Patch rebuild with only the changed files
    await this.buildIndex(projectDir)
  }

  /**
   * Wipe LEANN install and reinstall from scratch.
   */
  async reinstall(): Promise<void> {
    if (this.bridge) {
      await this.bridge.stop().catch(() => {})
      this.bridge = null
    }

    this.currentIndexPath = null

    // Remove setup marker
    const markerPath = getSetupMarkerPath()
    if (existsSync(markerPath)) {
      const { unlinkSync } = await import('node:fs')
      unlinkSync(markerPath)
    }

    this.globalStatus = 'not-ready'
    this.startSetup(this.onProgress || undefined)
  }

  async shutdown(): Promise<void> {
    if (this.bridge) {
      await this.bridge.stop().catch(() => {})
      this.bridge = null
    }
  }

  // -- Private --

  /**
   * Ensure the bridge is started with the given index path.
   * Restarts if pointing at a different path.
   */
  private async ensureBridge(indexPath: string): Promise<IndexerBridge> {
    if (this.globalStatus !== 'ready') throw new Error('Indexer not installed')

    if (this.bridge && this.currentIndexPath !== indexPath) {
      await this.bridge.stop().catch(() => {})
      this.bridge = null
    }

    if (!this.bridge || !this.bridge.isReady()) {
      this.bridge = new IndexerBridge()
      await this.bridge.start(getVenvPythonPath(), getWorkerPath(), indexPath, getModelCacheDir())
      this.currentIndexPath = indexPath
    }

    return this.bridge
  }

  private async doSetup(): Promise<void> {
    // Check if Python venv exists (may have been set up by crawl4ai)
    const pythonPath = getVenvPythonPath()
    const uvPath = getUvPath()
    const envDir = getEnvDir()

    if (!existsSync(pythonPath)) {
      // Need to set up Python first
      this.globalStatus = 'setting-up'
      this.onProgress?.({ step: 'installing-python', detail: `Python ${PYTHON_VERSION}` })
      mkdirSync(envDir, { recursive: true })
      await runCommand(uvPath, ['python', 'install', PYTHON_VERSION], { cwd: envDir })

      const venvPath = join(envDir, 'venv')
      if (!existsSync(venvPath)) {
        this.onProgress?.({ step: 'creating-env' })
        await runCommand(uvPath, ['venv', venvPath, '--python', PYTHON_VERSION], { cwd: envDir })
      }
    }

    // Install LEANN if needed
    if (!isSetupComplete()) {
      this.globalStatus = 'setting-up'
      this.onProgress?.({ step: 'installing-leann', detail: 'Installing LEANN and dependencies...' })

      const requirementsPath = getRequirementsPath()
      await runCommand(
        uvPath,
        ['pip', 'install', '-r', requirementsPath, '--python', pythonPath],
        { cwd: envDir }
      )

      // Pre-download the embedding model into a controlled cache directory
      const modelCacheDir = getModelCacheDir()
      mkdirSync(modelCacheDir, { recursive: true })
      this.onProgress?.({ step: 'downloading-model', detail: 'Downloading embedding model...' })
      await runCommand(
        pythonPath,
        ['-c', `from sentence_transformers import SentenceTransformer; SentenceTransformer("${EMBEDDING_MODEL}")`],
        { cwd: envDir, env: { HF_HOME: modelCacheDir } }
      )

      // Mark complete
      writeFileSync(getSetupMarkerPath(), getSetupHash())
    }

    // Don't start the bridge yet — it needs a project-specific index path.
    // It will be started lazily via ensureBridge() on first search/buildIndex call.
    this.globalStatus = 'ready'
    this.onProgress?.({ step: 'ready' })
  }
}
