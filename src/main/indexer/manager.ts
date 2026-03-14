import { app } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { createHash } from 'node:crypto'
import { IndexerBridge } from './bridge.js'
import { listFilesData } from '../sessions.js'

// -- Constants --

const LEANN_VERSION = '0.3.7'
const PYTHON_VERSION = '3.12'
const MAX_FILE_SIZE = 50 * 1024 // 50KB
const CHUNK_BATCH_SIZE = 50 // Files per chunk_files request

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
  if (INDEXER_SKIP_FILES.has(name)) return true
  return false
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
  if (app.isPackaged) {
    return join(process.resourcesPath, 'bin', 'uv')
  }
  return 'uv'
}

function getVenvPythonPath(): string {
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

function getIndexerDataDir(): string {
  return join(app.getPath('userData'), 'indexer')
}

function getProjectIndexDir(projectDir: string): string {
  const hash = createHash('sha256').update(projectDir).digest('hex').slice(0, 12)
  return join(getIndexerDataDir(), hash)
}

function getSetupHash(): string {
  return createHash('sha256')
    .update(`${PYTHON_VERSION}-leann-${LEANN_VERSION}-hnsw`)
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
          converted[path] = { mtime: mtime as number, chunkCount: 0, language: 'unknown', size: 0 }
        }
        return { files: converted, builtAt: raw.builtAt }
      }
      // Convert old symbolCount → chunkCount
      if (firstVal && typeof firstVal === 'object' && 'symbolCount' in (firstVal as object)) {
        const converted: Record<string, FileIndexInfo> = {}
        for (const [path, info] of Object.entries(raw.files)) {
          const old = info as Record<string, unknown>
          converted[path] = {
            mtime: (old.mtime as number) || 0,
            chunkCount: (old.symbolCount as number) || 0,
            language: (old.language as string) || 'unknown',
            size: (old.size as number) || 0,
          }
        }
        return { files: converted, builtAt: raw.builtAt }
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

// -- Shell helper --

function runCommand(cmd: string, args: string[], opts?: { cwd?: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: opts?.cwd,
      env: process.env,
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

    // Ensure index is fresh for this project
    await this.refreshIfStale(projectDir)

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
   * Uses LEANN's AST-aware chunking for code files.
   */
  async buildIndex(projectDir: string): Promise<void> {
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
      this.onProgress?.({ step: 'indexing', detail: `Chunking ${totalFiles} files...`, projectDir, progress: { current: 0, total: totalFiles } })

      // Read file contents and send to Python for AST chunking in batches
      const allChunks: { id: string; text: string; metadata: Record<string, unknown> }[] = []
      const chunkCountPerFile = new Map<string, number>()
      let processed = 0

      for (let i = 0; i < files.length; i += CHUNK_BATCH_SIZE) {
        const batch = files.slice(i, i + CHUNK_BATCH_SIZE)
        const fileContents: { path: string; content: string }[] = []

        for (const filePath of batch) {
          if (BINARY_EXTENSIONS.has(extname(filePath).toLowerCase())) continue
          if (shouldSkipForIndexing(filePath)) continue
          try {
            const fullPath = join(projectDir, filePath)
            const content = await readFile(fullPath, 'utf-8')
            if (content.length > MAX_FILE_SIZE) {
              // Still include but truncate for very large files
              fileContents.push({ path: filePath, content: content.slice(0, MAX_FILE_SIZE) })
            } else {
              fileContents.push({ path: filePath, content })
            }
          } catch { /* skip unreadable files */ }
        }

        if (fileContents.length > 0) {
          const chunks = await bridge.chunkFiles(fileContents)
          allChunks.push(...chunks)

          // Track chunk count per file
          for (const chunk of chunks) {
            const fp = (chunk.metadata?.file_path as string) || ''
            chunkCountPerFile.set(fp, (chunkCountPerFile.get(fp) || 0) + 1)
          }
        }

        processed += batch.length
        if (batch.length > 0) {
          this.onProgress?.({
            step: 'indexing',
            detail: batch[batch.length - 1],
            projectDir,
            progress: { current: processed, total: totalFiles },
          })
        }
      }

      this.onProgress?.({
        step: 'indexing',
        detail: `Building embedding index for ${allChunks.length} chunks from ${files.length} files...`,
        projectDir,
        progress: { current: totalFiles, total: totalFiles },
      })

      await bridge.buildIndex(allChunks)

      // Save metadata with per-file info
      const fileInfos: Record<string, FileIndexInfo> = {}
      for (const file of files) {
        try {
          const s = await stat(join(projectDir, file))
          fileInfos[file] = {
            mtime: s.mtimeMs,
            chunkCount: chunkCountPerFile.get(file) || 0,
            language: detectLanguage(file),
            size: s.size,
          }
        } catch { /* skip */ }
      }
      writeMetadata(projectDir, { files: fileInfos, builtAt: Date.now() })

      this.indexingProjectDir = null
      this.onProgress?.({ step: 'indexed', detail: `${allChunks.length} chunks from ${files.length} files indexed`, projectDir })
    } catch (err) {
      this.indexingProjectDir = null
      const detail = err instanceof Error ? err.message : String(err)
      this.projectErrors[projectDir] = detail
      this.onProgress?.({ step: 'error', detail, projectDir })
      throw err
    }
  }

  /**
   * Check if the index is stale and rebuild if needed.
   * LEANN compact HNSW doesn't support incremental updates, so any changes trigger a full rebuild.
   */
  async refreshIfStale(projectDir: string): Promise<void> {
    const meta = readMetadata(projectDir)
    if (!meta) {
      await this.buildIndex(projectDir)
      return
    }

    // Check for changes
    const currentFiles = await listFilesData(projectDir, 2000)
    const currentSet = new Set(currentFiles)
    const oldSet = new Set(Object.keys(meta.files))

    const added = currentFiles.filter(f => !oldSet.has(f))
    const removed = [...oldSet].filter(f => !currentSet.has(f))

    // Check modified files
    const modified: string[] = []
    for (const file of currentFiles) {
      if (oldSet.has(file)) {
        try {
          const s = await stat(join(projectDir, file))
          if (Math.abs(s.mtimeMs - (meta.files[file]?.mtime || 0)) > 1000) {
            modified.push(file)
          }
        } catch { /* skip */ }
      }
    }

    const totalChanged = added.length + removed.length + modified.length
    if (totalChanged === 0) return

    // Any changes → full rebuild (LEANN compact HNSW doesn't support incremental updates)
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
      await this.bridge.start(getVenvPythonPath(), getWorkerPath(), indexPath)
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

      // Mark complete
      writeFileSync(getSetupMarkerPath(), getSetupHash())
    }

    // Don't start the bridge yet — it needs a project-specific index path.
    // It will be started lazily via ensureBridge() on first search/buildIndex call.
    this.globalStatus = 'ready'
    this.onProgress?.({ step: 'ready' })
  }
}
