import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
// node:sqlite is built into Node 24 (Electron 41) — no npm dependency needed.
// It writes directly to disk and handles WAL mode natively.
import { DatabaseSync } from 'node:sqlite'
import type { AgentProviderId } from './provider'
import type { ProviderStatusInfo } from './provider-discovery'
import {
  appendIndexedSessionMessage,
  getIndexedSessionMessagesFromDb,
  initSessionIndexStorage,
  replaceIndexedSessionMessages,
} from './session-index-storage'

export interface IndexedSessionMeta {
  sessionId: string
  provider: AgentProviderId
  providerSessionId?: string
  createdAt: number
  updatedAt: number
  title?: string
  firstPrompt?: string
  workspaceDir?: string
  status?: 'active' | 'done' | 'error'
  hasPlan?: boolean
  archived?: boolean
  model?: string
  thinkingBudget?: string
}

export interface IndexedSessionMessagesRecord {
  provider: AgentProviderId
  rawMessages: unknown[]
}

// --- DB path ---

function getDbDir(): string {
  return path.join(app.getPath('userData'), 'agent-runtime')
}

function getDbPath(): string {
  return path.join(getDbDir(), 'sessions.db')
}

// --- DB singleton ---

let _db: DatabaseSync | null = null

function getDb(): DatabaseSync {
  if (_db) return _db

  mkdirSync(getDbDir(), { recursive: true })
  _db = new DatabaseSync(getDbPath())

  _db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      sessionId TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      providerSessionId TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      title TEXT,
      firstPrompt TEXT,
      workspaceDir TEXT,
      status TEXT,
      hasPlan INTEGER DEFAULT 0,
      archived INTEGER DEFAULT 0
    )
  `)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS provider_status (
      providerId TEXT PRIMARY KEY,
      installed INTEGER NOT NULL,
      loggedIn INTEGER NOT NULL,
      detail TEXT,
      email TEXT,
      org TEXT,
      updatedAt INTEGER NOT NULL
    )
  `)
  initSessionIndexStorage(_db)

  // Migration: add model column to sessions table
  try { _db.exec('ALTER TABLE sessions ADD COLUMN model TEXT') } catch { /* column already exists */ }
  try { _db.exec('ALTER TABLE sessions ADD COLUMN thinkingBudget TEXT') } catch { /* column already exists */ }

  // Plans table (per-session plan history with status tracking)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sessionId TEXT NOT NULL,
      content TEXT NOT NULL,
      filePath TEXT NOT NULL,
      toolIds TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    )
  `)
  _db.exec('CREATE INDEX IF NOT EXISTS idx_plans_session ON plans (sessionId, updatedAt DESC)')

  return _db
}

// Write mutex: serialises concurrent read-modify-write operations
let _writeMutex = Promise.resolve()

function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = _writeMutex.then(fn, fn)
  _writeMutex = next.then(() => {}, () => {})
  return next
}

// --- Public API ---

export async function getIndexedSessionMeta(sessionId: string): Promise<IndexedSessionMeta | null> {
  const db = getDb()
  const row = db.prepare('SELECT * FROM sessions WHERE sessionId = ?').get(sessionId) as Record<string, unknown> | undefined
  return row ? rowToMeta(row) : null
}

export async function listIndexedSessions(): Promise<IndexedSessionMeta[]> {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM sessions ORDER BY updatedAt DESC').all() as Record<string, unknown>[]
  return rows.map(rowToMeta)
}

export async function getIndexedSessionMessages(sessionId: string): Promise<IndexedSessionMessagesRecord | null> {
  const db = getDb()
  return getIndexedSessionMessagesFromDb(db, sessionId)
}

export async function upsertIndexedSession(
  sessionId: string,
  data: {
    provider: AgentProviderId
    providerSessionId?: string | null
    title?: string | null
    firstPrompt?: string | null
    workspaceDir?: string | null
    hasPlan?: boolean
    status?: 'active' | 'done' | 'error'
    updatedAt?: number | null
    model?: string | null
    thinkingBudget?: string | null
  },
): Promise<void> {
  return withWriteLock(async () => {
    upsertIndexedSessionSync(sessionId, data)
  })
}

export async function putIndexedRawMessages(sessionId: string, provider: AgentProviderId, rawMessages: unknown[]): Promise<void> {
  return withWriteLock(async () => {
    const db = getDb()
    replaceIndexedSessionMessages(db, sessionId, provider, rawMessages)
    upsertIndexedSessionSync(sessionId, { provider, updatedAt: Date.now() })
  })
}

export async function appendIndexedRawMessage(sessionId: string, provider: AgentProviderId, rawMessage: unknown): Promise<void> {
  return withWriteLock(async () => {
    const db = getDb()
    appendIndexedSessionMessage(db, sessionId, provider, rawMessage)
    upsertIndexedSessionSync(sessionId, { provider, updatedAt: Date.now() })
  })
}

// --- Plan storage ---

export interface SessionPlan {
  id: number
  sessionId: string
  content: string
  filePath: string
  toolIds: string[]
  status: 'pending' | 'approved' | 'rejected'
  createdAt: number
  updatedAt: number
}

export async function upsertSessionPlan(
  sessionId: string,
  data: { content: string; filePath: string; toolIds: string[]; status?: 'pending' | 'approved' | 'rejected' },
): Promise<void> {
  return withWriteLock(async () => {
    const db = getDb()
    const now = Date.now()
    const status = data.status ?? 'pending'
    // Update existing pending plan for this session, or insert new
    const existing = db.prepare(
      "SELECT id FROM plans WHERE sessionId = ? AND status = 'pending' ORDER BY updatedAt DESC LIMIT 1",
    ).get(sessionId) as { id: number } | undefined
    if (existing) {
      db.prepare(
        'UPDATE plans SET content = ?, filePath = ?, toolIds = ?, status = ?, updatedAt = ? WHERE id = ?',
      ).run(data.content, data.filePath, JSON.stringify(data.toolIds), status, now, existing.id)
    } else {
      db.prepare(
        'INSERT INTO plans (sessionId, content, filePath, toolIds, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(sessionId, data.content, data.filePath, JSON.stringify(data.toolIds), status, now, now)
    }
  })
}

export async function updatePlanStatus(
  sessionId: string,
  status: 'pending' | 'approved' | 'rejected',
): Promise<void> {
  return withWriteLock(async () => {
    const db = getDb()
    const now = Date.now()
    db.prepare(
      'UPDATE plans SET status = ?, updatedAt = ? WHERE id = (SELECT id FROM plans WHERE sessionId = ? ORDER BY updatedAt DESC LIMIT 1)',
    ).run(status, now, sessionId)
  })
}

export async function getSessionPlan(sessionId: string): Promise<SessionPlan | null> {
  const db = getDb()
  const row = db.prepare(
    'SELECT * FROM plans WHERE sessionId = ? ORDER BY updatedAt DESC LIMIT 1',
  ).get(sessionId) as Record<string, unknown> | undefined
  return row ? rowToPlan(row) : null
}

export async function getApprovedPlan(sessionId: string): Promise<SessionPlan | null> {
  const db = getDb()
  const row = db.prepare(
    "SELECT * FROM plans WHERE sessionId = ? AND status = 'approved' ORDER BY updatedAt DESC LIMIT 1",
  ).get(sessionId) as Record<string, unknown> | undefined
  return row ? rowToPlan(row) : null
}

function rowToPlan(row: Record<string, unknown>): SessionPlan {
  let toolIds: string[] = []
  try { toolIds = JSON.parse(row.toolIds as string) } catch { /* ignore */ }
  return {
    id: row.id as number,
    sessionId: row.sessionId as string,
    content: row.content as string,
    filePath: row.filePath as string,
    toolIds,
    status: row.status as 'pending' | 'approved' | 'rejected',
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number,
  }
}

// --- Provider status cache (persisted) ---

export function getPersistedProviderStatus(): Record<string, ProviderStatusInfo> | null {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM provider_status').all() as Array<Record<string, unknown>>
  if (rows.length === 0) return null
  const result: Record<string, ProviderStatusInfo> = {}
  for (const row of rows) {
    result[row.providerId as string] = {
      installed: row.installed === 1,
      loggedIn: row.loggedIn === 1,
      detail: (row.detail as string | null) ?? undefined,
      email: (row.email as string | null) ?? undefined,
      org: (row.org as string | null) ?? undefined,
    }
  }
  return result
}

export function persistProviderStatus(providerId: string, status: ProviderStatusInfo): void {
  const db = getDb()
  db.prepare(
    `INSERT OR REPLACE INTO provider_status (providerId, installed, loggedIn, detail, email, org, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    providerId,
    status.installed ? 1 : 0,
    status.loggedIn ? 1 : 0,
    status.detail ?? null,
    status.email ?? null,
    status.org ?? null,
    Date.now(),
  )
}

// --- Internal sync helpers ---

function upsertIndexedSessionSync(
  sessionId: string,
  data: {
    provider: AgentProviderId
    providerSessionId?: string | null
    title?: string | null
    firstPrompt?: string | null
    workspaceDir?: string | null
    hasPlan?: boolean
    status?: 'active' | 'done' | 'error'
    updatedAt?: number | null
    model?: string | null
    thinkingBudget?: string | null
  },
): void {
  const db = getDb()
  const now = Date.now()
  const prev = db.prepare('SELECT createdAt, archived, model, thinkingBudget, title, firstPrompt FROM sessions WHERE sessionId = ?').get(sessionId) as { createdAt: number; archived: number; model: string | null; thinkingBudget: string | null; title: string | null; firstPrompt: string | null } | undefined

  db.prepare(
    `INSERT OR REPLACE INTO sessions
      (sessionId, provider, providerSessionId, createdAt, updatedAt, title, firstPrompt, workspaceDir, status, hasPlan, archived, model, thinkingBudget)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    data.provider,
    data.providerSessionId ?? null,
    prev?.createdAt ?? now,
    data.updatedAt ?? now,
    data.title !== undefined ? data.title : (prev?.title ?? null),
    data.firstPrompt !== undefined ? data.firstPrompt : (prev?.firstPrompt ?? null),
    data.workspaceDir ?? null,
    data.status ?? 'active',
    data.hasPlan ? 1 : 0,
    prev?.archived ?? 0,
    data.model ?? prev?.model ?? null,
    data.thinkingBudget ?? prev?.thinkingBudget ?? null,
  )
}

function rowToMeta(row: Record<string, unknown>): IndexedSessionMeta {
  return {
    sessionId: row.sessionId as string,
    provider: row.provider as AgentProviderId,
    providerSessionId: (row.providerSessionId as string | null) ?? undefined,
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number,
    title: (row.title as string | null) ?? undefined,
    firstPrompt: (row.firstPrompt as string | null) ?? undefined,
    workspaceDir: (row.workspaceDir as string | null) ?? undefined,
    status: (row.status as 'active' | 'done' | 'error' | null) ?? undefined,
    hasPlan: row.hasPlan === 1,
    archived: row.archived === 1,
    model: (row.model as string | null) ?? undefined,
    thinkingBudget: (row.thinkingBudget as string | null) ?? undefined,
  }
}
