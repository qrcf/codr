import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface, type Interface as ReadlineInterface } from 'node:readline'

export interface SearchResult {
  id: string
  score: number
  text: string
  metadata: Record<string, unknown>
}

export interface ChunkResult {
  id: string
  text: string
  metadata: Record<string, unknown>
}

interface JsonMessage {
  id?: string
  type?: string
  ok?: boolean
  status?: string
  error?: string
  count?: number
  results?: SearchResult[]
  chunks?: ChunkResult[]
}

export class IndexerBridge {
  private process: ChildProcess | null = null
  private readline: ReadlineInterface | null = null
  private ready = false
  private nextId = 1
  private pendingRequests = new Map<string, {
    resolve: (value: JsonMessage) => void
    reject: (reason: Error) => void
  }>()

  /**
   * Spawn the Python worker and send init command.
   */
  async start(pythonPath: string, workerPath: string, indexPath?: string): Promise<void> {
    // Kill any existing process first
    this.cleanup()

    const proc = spawn(pythonPath, [workerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.process = proc

    this.readline = createInterface({ input: proc.stdout! })
    this.readline.on('line', (line) => this.handleLine(line))

    proc.stderr?.on('data', (data) => {
      console.error('[indexer]', data.toString().trim())
    })

    // Capture `proc` in closure so stale exit events from old processes are ignored
    proc.on('exit', (code, signal) => {
      if (this.process !== proc) return // stale event from a previous process
      console.error(`[indexer] Worker exited: code=${code}, signal=${signal}`)
      this.process = null
      this.ready = false
      for (const [, pending] of this.pendingRequests) {
        pending.reject(new Error(`Indexer worker exited (code=${code}, signal=${signal})`))
      }
      this.pendingRequests.clear()
    })

    proc.on('error', (err) => {
      if (this.process !== proc) return // stale event from a previous process
      console.error('[indexer] Worker spawn error:', err.message)
      this.process = null
      this.ready = false
      for (const [, pending] of this.pendingRequests) {
        pending.reject(new Error(`Indexer worker spawn failed: ${err.message}`))
      }
      this.pendingRequests.clear()
    })

    const config: Record<string, unknown> = {}
    if (indexPath) config.index_path = indexPath

    const result = await this.sendRequest({ cmd: 'init', config })
    if (!result.ok) {
      throw new Error(result.error || 'Failed to initialize indexer worker')
    }
    this.ready = true
  }

  /**
   * AST-aware chunking of source files.
   */
  async chunkFiles(files: { path: string; content: string }[]): Promise<ChunkResult[]> {
    if (!this.ready) throw new Error('Indexer bridge not started')
    const result = await this.sendRequest({ cmd: 'chunk_files', files }, 300000)
    if (!result.ok) throw new Error(result.error || 'chunk_files failed')
    return result.chunks || []
  }

  /**
   * Build the full index from pre-chunked documents.
   */
  async buildIndex(chunks: ChunkResult[]): Promise<{ count: number }> {
    if (!this.ready) throw new Error('Indexer bridge not started')
    const result = await this.sendRequest({ cmd: 'build_index', chunks }, 300000)
    if (!result.ok) throw new Error(result.error || 'build_index failed')
    return { count: result.count || 0 }
  }

  /**
   * Search the index.
   */
  async search(query: string, limit = 15): Promise<SearchResult[]> {
    if (!this.ready) throw new Error('Indexer bridge not started')
    const result = await this.sendRequest({ cmd: 'search', query, limit })
    if (!result.ok) throw new Error(result.error || 'search failed')
    return result.results || []
  }

  /**
   * Graceful shutdown.
   */
  async stop(): Promise<void> {
    if (!this.process) return
    try {
      await this.sendRequest({ cmd: 'shutdown' })
    } catch { /* ignore */ }
    this.cleanup()
  }

  /**
   * Hard kill.
   */
  kill(): void {
    this.cleanup()
  }

  isReady(): boolean {
    return this.ready
  }

  private cleanup(): void {
    const proc = this.process
    if (proc) {
      proc.kill('SIGKILL')
      this.process = null
    }
    if (this.readline) {
      this.readline.close()
      this.readline = null
    }
    this.ready = false
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('Worker killed'))
    }
    this.pendingRequests.clear()
  }

  private handleLine(line: string): void {
    let msg: JsonMessage
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }

    const id = msg.id || ''
    const pending = this.pendingRequests.get(id)
    if (pending) {
      this.pendingRequests.delete(id)
      if (msg.ok === false || msg.type === 'error') {
        pending.reject(new Error(msg.error || 'Request failed'))
      } else {
        pending.resolve(msg)
      }
    }
  }

  private sendRequest(msg: Record<string, unknown>, timeoutMs = 60000): Promise<JsonMessage> {
    const id = String(this.nextId++)
    msg.id = id

    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error('Worker process not available'))
        return
      }
      this.pendingRequests.set(id, { resolve, reject })
      this.process.stdin.write(JSON.stringify(msg) + '\n')

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(new Error(`Request ${id} timed out after ${timeoutMs}ms`))
        }
      }, timeoutMs)
    })
  }
}
