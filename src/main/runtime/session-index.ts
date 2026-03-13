import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
// node:sqlite is built into Node 24 (Electron 41) — no npm dependency needed.
// It writes directly to disk and handles WAL mode natively.
import { DatabaseSync } from 'node:sqlite'
import type { AgentProviderId } from './provider'

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
    CREATE TABLE IF NOT EXISTS session_messages (
      sessionId TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      messagesJson TEXT NOT NULL
    )
  `)

  // Migration: add model column to sessions table
  try { _db.exec('ALTER TABLE sessions ADD COLUMN model TEXT') } catch { /* column already exists */ }
  try { _db.exec('ALTER TABLE sessions ADD COLUMN thinkingBudget TEXT') } catch { /* column already exists */ }

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
  const row = db.prepare('SELECT provider, messagesJson FROM session_messages WHERE sessionId = ?').get(sessionId) as { provider: string; messagesJson: string } | undefined
  if (!row) return null
  try {
    return { provider: row.provider as AgentProviderId, rawMessages: JSON.parse(row.messagesJson) as unknown[] }
  } catch {
    return null
  }
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
    db.prepare(
      'INSERT OR REPLACE INTO session_messages (sessionId, provider, messagesJson) VALUES (?, ?, ?)',
    ).run(sessionId, provider, JSON.stringify(rawMessages))
    upsertIndexedSessionSync(sessionId, { provider, updatedAt: Date.now() })
  })
}

export async function appendIndexedRawMessage(sessionId: string, provider: AgentProviderId, rawMessage: unknown): Promise<void> {
  return withWriteLock(async () => {
    const db = getDb()
    const existing = db.prepare('SELECT messagesJson FROM session_messages WHERE sessionId = ?').get(sessionId) as { messagesJson: string } | undefined
    let messages: unknown[]
    if (existing) {
      try { messages = JSON.parse(existing.messagesJson) as unknown[] } catch { messages = [] }
    } else {
      messages = []
    }
    messages.push(rawMessage)
    db.prepare(
      'INSERT OR REPLACE INTO session_messages (sessionId, provider, messagesJson) VALUES (?, ?, ?)',
    ).run(sessionId, provider, JSON.stringify(messages))
    upsertIndexedSessionSync(sessionId, { provider, updatedAt: Date.now() })
  })
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
  const prev = db.prepare('SELECT createdAt, archived, model, thinkingBudget FROM sessions WHERE sessionId = ?').get(sessionId) as { createdAt: number; archived: number; model: string | null; thinkingBudget: string | null } | undefined

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
    data.title ?? null,
    data.firstPrompt ?? null,
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
