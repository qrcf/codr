import { DatabaseSync } from 'node:sqlite'
import type { AgentProviderId } from './provider'

export interface IndexedSessionMessagesRecord {
  provider: AgentProviderId
  rawMessages: unknown[]
}

export function initSessionIndexStorage(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_messages (
      sessionId TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      messagesJson TEXT NOT NULL
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_messages_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sessionId TEXT NOT NULL,
      provider TEXT NOT NULL,
      messageJson TEXT NOT NULL
    )
  `)
  db.exec('CREATE INDEX IF NOT EXISTS idx_sm2_session ON session_messages_v2(sessionId)')
}

export function shouldPersistIndexedMessage(rawMessage: unknown): boolean {
  if (!rawMessage || typeof rawMessage !== 'object') return false
  const type = (rawMessage as { type?: unknown }).type
  return type === 'user' || type === 'assistant'
}

export function getIndexedSessionMessagesFromDb(
  db: DatabaseSync,
  sessionId: string,
): IndexedSessionMessagesRecord | null {
  migrateLegacySessionMessages(db, sessionId)

  const rows = db.prepare(
    'SELECT provider, messageJson FROM session_messages_v2 WHERE sessionId = ? ORDER BY id ASC',
  ).all(sessionId) as Array<{ provider: string; messageJson: string }>

  if (rows.length === 0) return null

  try {
    return {
      provider: rows[0]!.provider as AgentProviderId,
      rawMessages: rows.map((row) => JSON.parse(row.messageJson) as unknown),
    }
  } catch {
    return null
  }
}

export function replaceIndexedSessionMessages(
  db: DatabaseSync,
  sessionId: string,
  provider: AgentProviderId,
  rawMessages: unknown[],
): void {
  migrateLegacySessionMessages(db, sessionId)

  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM session_messages_v2 WHERE sessionId = ?').run(sessionId)
    insertMessages(db, sessionId, provider, rawMessages)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function appendIndexedSessionMessage(
  db: DatabaseSync,
  sessionId: string,
  provider: AgentProviderId,
  rawMessage: unknown,
): void {
  migrateLegacySessionMessages(db, sessionId)
  db.prepare(
    'INSERT INTO session_messages_v2 (sessionId, provider, messageJson) VALUES (?, ?, ?)',
  ).run(sessionId, provider, JSON.stringify(rawMessage))
}

function migrateLegacySessionMessages(db: DatabaseSync, sessionId: string): void {
  const legacy = db.prepare(
    'SELECT provider, messagesJson FROM session_messages WHERE sessionId = ?',
  ).get(sessionId) as { provider: string; messagesJson: string } | undefined

  if (!legacy) return

  const hasV2Rows = db.prepare(
    'SELECT 1 FROM session_messages_v2 WHERE sessionId = ? LIMIT 1',
  ).get(sessionId)

  if (hasV2Rows) {
    db.prepare('DELETE FROM session_messages WHERE sessionId = ?').run(sessionId)
    return
  }

  let rawMessages: unknown[]
  try {
    const parsed = JSON.parse(legacy.messagesJson) as unknown
    rawMessages = Array.isArray(parsed) ? parsed : []
  } catch {
    rawMessages = []
  }

  db.exec('BEGIN')
  try {
    insertMessages(db, sessionId, legacy.provider as AgentProviderId, rawMessages)
    db.prepare('DELETE FROM session_messages WHERE sessionId = ?').run(sessionId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function insertMessages(
  db: DatabaseSync,
  sessionId: string,
  provider: AgentProviderId,
  rawMessages: unknown[],
): void {
  const insert = db.prepare(
    'INSERT INTO session_messages_v2 (sessionId, provider, messageJson) VALUES (?, ?, ?)',
  )
  for (const rawMessage of rawMessages) {
    insert.run(sessionId, provider, JSON.stringify(rawMessage))
  }
}
