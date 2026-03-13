import { app } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const PYTHON_VERSION = '3.12'
const CRAWL4AI_VERSION = '0.8.0'

export interface SetupProgress {
  step: 'installing-python' | 'creating-env' | 'installing-crawl4ai' | 'downloading-browser' | 'ready' | 'error'
  detail?: string
  stepIndex: number
  totalSteps: number
}

function getEnvDir(): string {
  return join(app.getPath('userData'), 'python-env')
}

function getUvPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'bin', 'uv')
  }
  // In dev, use system uv (must be on PATH)
  return 'uv'
}

function getSetupHash(): string {
  return createHash('sha256')
    .update(`${PYTHON_VERSION}-crawl4ai-${CRAWL4AI_VERSION}`)
    .digest('hex')
    .slice(0, 16)
}

function isSetupComplete(): boolean {
  const markerPath = join(getEnvDir(), '.setup-complete')
  if (!existsSync(markerPath)) return false
  try {
    return readFileSync(markerPath, 'utf-8').trim() === getSetupHash()
  } catch {
    return false
  }
}

function getVenvPythonPath(): string {
  return join(getEnvDir(), 'venv', 'bin', 'python')
}

function runCommand(cmd: string, args: string[], opts?: { cwd?: string; env?: NodeJS.ProcessEnv }): Promise<string> {
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

/**
 * Ensure the Python runtime (Python + crawl4ai + Playwright) is installed.
 * Idempotent — skips if already set up with matching version hash.
 * Returns the path to the venv Python binary.
 */
export async function ensurePythonRuntime(
  onProgress?: (progress: SetupProgress) => void
): Promise<string> {
  if (isSetupComplete()) {
    return getVenvPythonPath()
  }

  const envDir = getEnvDir()
  mkdirSync(envDir, { recursive: true })
  const uvPath = getUvPath()
  const venvPath = join(envDir, 'venv')
  const totalSteps = 4

  try {
    // Step 1: Install Python
    onProgress?.({ step: 'installing-python', detail: `Python ${PYTHON_VERSION}`, stepIndex: 0, totalSteps })
    await runCommand(uvPath, ['python', 'install', PYTHON_VERSION], { cwd: envDir })

    // Step 2: Create venv
    onProgress?.({ step: 'creating-env', stepIndex: 1, totalSteps })
    // Remove stale venv if exists
    if (existsSync(venvPath)) {
      const { rmSync } = await import('node:fs')
      rmSync(venvPath, { recursive: true, force: true })
    }
    await runCommand(uvPath, ['venv', venvPath, '--python', PYTHON_VERSION], { cwd: envDir })

    // Step 3: Install crawl4ai
    onProgress?.({ step: 'installing-crawl4ai', detail: `crawl4ai ${CRAWL4AI_VERSION}`, stepIndex: 2, totalSteps })
    const requirementsPath = getRequirementsPath()
    await runCommand(
      uvPath,
      ['pip', 'install', '-r', requirementsPath, '--python', getVenvPythonPath()],
      { cwd: envDir }
    )

    // Step 4: Install Playwright Chromium
    onProgress?.({ step: 'downloading-browser', detail: 'Chromium', stepIndex: 3, totalSteps })
    await runCommand(
      getVenvPythonPath(),
      ['-m', 'playwright', 'install', 'chromium'],
      { cwd: envDir }
    )

    // Mark setup complete
    writeFileSync(join(envDir, '.setup-complete'), getSetupHash())
    onProgress?.({ step: 'ready', stepIndex: 4, totalSteps })

    return getVenvPythonPath()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    onProgress?.({ step: 'error', detail: message, stepIndex: -1, totalSteps })
    throw err
  }
}

/**
 * Get the path to the Python worker script.
 */
export function getWorkerPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'crawl4ai', 'worker.py')
  }
  return join(__dirname, '../../resources/crawl4ai/worker.py')
}

/**
 * Get the path to the requirements.txt file.
 */
function getRequirementsPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'crawl4ai', 'requirements.txt')
  }
  return join(__dirname, '../../resources/crawl4ai/requirements.txt')
}

/**
 * Get the path to the venv Python binary (for external use).
 */
export function getPythonPath(): string {
  return getVenvPythonPath()
}

/**
 * Reset the Python runtime so the next ensurePythonRuntime() call re-installs everything.
 * Deletes the entire python-env directory.
 */
export async function resetPythonRuntime(): Promise<void> {
  const envDir = getEnvDir()
  if (existsSync(envDir)) {
    const { rmSync } = await import('node:fs')
    rmSync(envDir, { recursive: true, force: true })
  }
}
