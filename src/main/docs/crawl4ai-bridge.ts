import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface, type Interface as ReadlineInterface } from 'node:readline'
import { ensurePythonRuntime, getPythonPath, getWorkerPath, type SetupProgress } from './python-runtime.js'

export interface CrawlPageResult {
  url: string
  title: string
  markdown: string
  depth: number
}

interface JsonMessage {
  id?: string
  type?: string
  ok?: boolean
  status?: string
  error?: string
  url?: string
  title?: string
  markdown?: string
  depth?: number
  pages_crawled?: number
}

export class Crawl4AIBridge {
  private process: ChildProcess | null = null
  private readline: ReadlineInterface | null = null
  private ready = false
  private nextId = 1

  // For init and shutdown — simple request/response
  private pendingRequests = new Map<string, {
    resolve: (value: JsonMessage) => void
    reject: (reason: Error) => void
  }>()

  // For crawl_site — streaming page results
  private activeCrawl: {
    id: string
    onPage: (page: CrawlPageResult) => Promise<void>
    resolve: (pagesCrawled: number) => void
    reject: (reason: Error) => void
    pendingPages: Promise<void>[]
  } | null = null

  /**
   * Ensure the Python runtime is set up, spawn the worker, and initialize the browser.
   */
  async start(onSetupProgress?: (progress: SetupProgress) => void): Promise<void> {
    await ensurePythonRuntime(onSetupProgress)

    const pythonPath = getPythonPath()
    const workerPath = getWorkerPath()

    this.process = spawn(pythonPath, [workerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.readline = createInterface({ input: this.process.stdout! })
    this.readline.on('line', (line) => this.handleLine(line))

    this.process.stderr?.on('data', (data) => {
      console.error('[crawl4ai]', data.toString().trim())
    })

    this.process.on('exit', (code) => {
      this.process = null
      this.ready = false
      // Reject all pending requests
      for (const [, pending] of this.pendingRequests) {
        pending.reject(new Error(`Python worker exited with code ${code}`))
      }
      this.pendingRequests.clear()
      // Reject active crawl
      if (this.activeCrawl) {
        this.activeCrawl.reject(new Error(`Python worker exited with code ${code}`))
        this.activeCrawl = null
      }
    })

    // Send init command
    const result = await this.sendRequest({ cmd: 'init', config: {} })
    if (!result.ok) {
      throw new Error(result.error || 'Failed to initialize Crawl4AI worker')
    }
    this.ready = true
  }

  /**
   * Run a full site crawl. Calls onPage for each page as it arrives.
   * Returns the total number of pages crawled.
   */
  crawlSite(
    url: string,
    maxDepth: number,
    maxPages: number,
    prefix: string | undefined,
    onPage: (page: CrawlPageResult) => Promise<void>
  ): Promise<number> {
    if (!this.ready) return Promise.reject(new Error('Crawl4AI bridge not started'))
    if (this.activeCrawl) return Promise.reject(new Error('A crawl is already in progress'))

    const id = String(this.nextId++)

    return new Promise((resolve, reject) => {
      this.activeCrawl = { id, onPage, resolve, reject, pendingPages: [] }

      const msg: Record<string, unknown> = {
        cmd: 'crawl_site',
        id,
        url,
        max_depth: maxDepth,
        max_pages: maxPages,
      }
      if (prefix) msg.prefix = prefix

      this.process!.stdin!.write(JSON.stringify(msg) + '\n')
    })
  }

  /**
   * Graceful shutdown — tells the worker to close the browser and exit.
   */
  async stop(): Promise<void> {
    if (!this.process) return
    try {
      await this.sendRequest({ cmd: 'shutdown' })
    } catch { /* ignore errors during shutdown */ }
    this.cleanup()
  }

  /**
   * Hard kill for abort scenarios — immediately terminates the Python process.
   */
  kill(): void {
    if (this.activeCrawl) {
      this.activeCrawl.reject(new Error('Crawl aborted'))
      this.activeCrawl = null
    }
    this.cleanup()
  }

  private cleanup(): void {
    if (this.process) {
      this.process.kill('SIGKILL')
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
      return // ignore non-JSON lines
    }

    const id = msg.id || ''

    // Check if this is a streaming crawl result
    if (this.activeCrawl && id === this.activeCrawl.id) {
      if (msg.type === 'page') {
        // Track the onPage promise so we can await all before resolving complete
        const page: CrawlPageResult = {
          url: msg.url || '',
          title: msg.title || '',
          markdown: msg.markdown || '',
          depth: msg.depth || 0,
        }
        const pagePromise = this.activeCrawl.onPage(page).catch((err) => {
          console.error('[crawl4ai] onPage callback error:', err)
        })
        this.activeCrawl.pendingPages.push(pagePromise)
        return
      }
      if (msg.type === 'complete') {
        const crawl = this.activeCrawl
        this.activeCrawl = null
        // Wait for all onPage callbacks to finish before resolving
        Promise.all(crawl.pendingPages).then(() => {
          crawl.resolve(msg.pages_crawled || 0)
        }).catch((err) => {
          crawl.reject(err instanceof Error ? err : new Error(String(err)))
        })
        return
      }
      if (msg.type === 'error') {
        const crawl = this.activeCrawl
        this.activeCrawl = null
        crawl.reject(new Error(msg.error || 'Crawl failed'))
        return
      }
    }

    // Simple request/response (init, shutdown)
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

  private sendRequest(msg: Record<string, unknown>): Promise<JsonMessage> {
    const id = String(this.nextId++)
    msg.id = id

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject })
      this.process!.stdin!.write(JSON.stringify(msg) + '\n')

      // Timeout for non-crawl requests (init/shutdown)
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(new Error(`Request ${id} timed out`))
        }
      }, 60000) // 60s for init (browser startup can be slow)
    })
  }
}
