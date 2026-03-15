import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path, { join } from 'node:path'

// Exported so sessions.ts can import without a circular dependency
export const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.cache',
  '__pycache__', '.venv', 'venv', '.tox', 'coverage', '.nyc_output',
])

export const IGNORE_FILES = ['.gitignore', '.codrignore', '.cursorignore', '.copilotignore', '.aiderignore']

// --- Interfaces ---

export interface GlobalFilesConfigFile {
  ignoreDirs?: string[]
  extraIgnoreFiles?: string[]
}

export interface ProjectFilesConfigFile {
  extraIgnoreDirs?: string[]
  extraPatterns?: string[]
}

export interface ResolvedFilesConfig {
  ignoreDirs: string[]
  extraIgnoreFiles: string[]
  extraPatterns: string[]
}

export type IgnoreSource =
  | 'global'
  | 'gitignore'
  | 'codrignore'
  | 'cursorignore'
  | 'copilotignore'
  | 'aiderignore'
  | 'project'

export interface TaggedIgnoreEntry {
  pattern: string
  source: IgnoreSource
}

// --- Caches ---

const DEFAULT_IGNORE_DIRS = Array.from(IGNORED_DIRS)

let cachedGlobal: Required<GlobalFilesConfigFile> | null = null

// --- Path helpers ---

function getGlobalConfigPath(): string {
  return path.join(app.getPath('userData'), 'agent-runtime', 'files-config.json')
}

function getProjectConfigPath(projectDir: string): string {
  const hash = createHash('sha256').update(projectDir).digest('hex').slice(0, 12)
  return path.join(app.getPath('userData'), 'agent-runtime', 'project-files', `${hash}.json`)
}

async function ensureDir(filePath: string) {
  await mkdir(path.dirname(filePath), { recursive: true })
}

// --- Global config ---

export async function getGlobalFilesConfig(): Promise<Required<GlobalFilesConfigFile>> {
  if (cachedGlobal) return cachedGlobal
  try {
    const raw = await readFile(getGlobalConfigPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<GlobalFilesConfigFile>
    cachedGlobal = {
      ignoreDirs: parsed.ignoreDirs ?? DEFAULT_IGNORE_DIRS,
      extraIgnoreFiles: parsed.extraIgnoreFiles ?? [],
    }
  } catch {
    cachedGlobal = { ignoreDirs: DEFAULT_IGNORE_DIRS, extraIgnoreFiles: [] }
  }
  return cachedGlobal
}

export async function setGlobalFilesConfig(cfg: Partial<GlobalFilesConfigFile>): Promise<void> {
  const current = await getGlobalFilesConfig()
  const updated: Required<GlobalFilesConfigFile> = {
    ignoreDirs: cfg.ignoreDirs ?? current.ignoreDirs,
    extraIgnoreFiles: cfg.extraIgnoreFiles ?? current.extraIgnoreFiles,
  }
  cachedGlobal = updated
  const configPath = getGlobalConfigPath()
  await ensureDir(configPath)
  await writeFile(configPath, JSON.stringify(updated, null, 2), 'utf-8')
}

// --- Per-project config ---

export async function getProjectFilesConfig(projectDir: string): Promise<ProjectFilesConfigFile> {
  try {
    const raw = await readFile(getProjectConfigPath(projectDir), 'utf-8')
    return JSON.parse(raw) as ProjectFilesConfigFile
  } catch {
    return {}
  }
}

export async function setProjectFilesConfig(projectDir: string, cfg: Partial<ProjectFilesConfigFile>): Promise<void> {
  const current = await getProjectFilesConfig(projectDir)
  const updated: ProjectFilesConfigFile = { ...current, ...cfg }
  const configPath = getProjectConfigPath(projectDir)
  await ensureDir(configPath)
  await writeFile(configPath, JSON.stringify(updated, null, 2), 'utf-8')
}

// --- Resolved (merged) config ---

export async function resolveFilesConfig(projectDir: string): Promise<ResolvedFilesConfig> {
  const [global, project] = await Promise.all([
    getGlobalFilesConfig(),
    getProjectFilesConfig(projectDir),
  ])
  return {
    ignoreDirs: [...global.ignoreDirs, ...(project.extraIgnoreDirs ?? [])],
    extraIgnoreFiles: global.extraIgnoreFiles,
    extraPatterns: project.extraPatterns ?? [],
  }
}

// --- Computed tagged ignore entries (for UI display) ---

const IGNORE_FILE_SOURCE_MAP: Array<[string, IgnoreSource]> = [
  ['.gitignore', 'gitignore'],
  ['.codrignore', 'codrignore'],
  ['.cursorignore', 'cursorignore'],
  ['.copilotignore', 'copilotignore'],
  ['.aiderignore', 'aiderignore'],
]

export async function computeTaggedIgnoreEntries(projectDir: string): Promise<TaggedIgnoreEntry[]> {
  const entries: TaggedIgnoreEntry[] = []

  // 1. Global ignore dirs (user-visible, defaults to IGNORED_DIRS)
  const global = await getGlobalFilesConfig()
  for (const d of global.ignoreDirs) {
    entries.push({ pattern: d + '/', source: 'global' })
  }

  // 2. Standard ignore files
  for (const [filename, source] of IGNORE_FILE_SOURCE_MAP) {
    try {
      const content = await readFile(join(projectDir, filename), 'utf-8')
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (trimmed && !trimmed.startsWith('#')) {
          entries.push({ pattern: trimmed, source })
        }
      }
    } catch { /* file doesn't exist */ }
  }

  // 4. Extra ignore files from global config (deduplicated against standard ones)
  const standardNames = new Set(IGNORE_FILES)
  for (const extraFile of global.extraIgnoreFiles) {
    if (standardNames.has(extraFile)) continue
    try {
      const content = await readFile(join(projectDir, extraFile), 'utf-8')
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (trimmed && !trimmed.startsWith('#')) {
          entries.push({ pattern: trimmed, source: 'global' })
        }
      }
    } catch { /* file doesn't exist */ }
  }

  // 5. Project-level extra patterns
  const project = await getProjectFilesConfig(projectDir)
  for (const p of (project.extraPatterns ?? [])) {
    if (p.trim()) entries.push({ pattern: p.trim(), source: 'project' })
  }

  return entries
}
