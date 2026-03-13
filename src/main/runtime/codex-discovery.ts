/**
 * Reads Codex thread metadata from ~/.codex/state_5.sqlite (read-only).
 * Uses node:sqlite (built into Node 24 / Electron 41) which handles WAL mode
 * natively -- loading raw bytes (sql.js approach) misses WAL journal entries.
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export interface CodexThreadInfo {
  id: string
  title: string | null
  firstUserMessage: string | null
  cwd: string | null
  createdAt: number
  updatedAt: number
  rolloutPath: string | null
  gitBranch: string | null
}

function getCodexDbPath(): string {
  return path.join(homedir(), '.codex', 'state_5.sqlite')
}

export function getCodexDbPath_exported(): string {
  return getCodexDbPath()
}

export function listCodexThreads(): CodexThreadInfo[] {
  const dbPath = getCodexDbPath()
  if (!existsSync(dbPath)) return []

  let db: DatabaseSync | null = null
  try {
    db = new DatabaseSync(dbPath, { open: true, readOnly: true })
    const rows = db.prepare(`
      SELECT id, title, first_user_message, cwd, created_at, updated_at, rollout_path, git_branch
      FROM threads
      WHERE archived = 0
      ORDER BY updated_at DESC
      LIMIT 100
    `).all() as Record<string, unknown>[]

    return rows.map(row => ({
      id: row.id as string,
      title: (row.title as string | null) || null,
      firstUserMessage: (row.first_user_message as string | null) || null,
      cwd: (row.cwd as string | null) || null,
      createdAt: (row.created_at as number) * 1000,
      updatedAt: (row.updated_at as number) * 1000,
      rolloutPath: (row.rollout_path as string | null) || null,
      gitBranch: (row.git_branch as string | null) || null,
    }))
  } catch (err) {
    console.warn('[codex-discovery] Failed to read Codex threads:', err)
    return []
  } finally {
    db?.close()
  }
}

export function getCodexThreadRolloutPath(threadId: string): string | null {
  const dbPath = getCodexDbPath()
  if (!existsSync(dbPath)) return null

  let db: DatabaseSync | null = null
  try {
    db = new DatabaseSync(dbPath, { open: true, readOnly: true })
    const row = db.prepare('SELECT rollout_path FROM threads WHERE id = ?').get(threadId) as { rollout_path: string | null } | undefined
    return row?.rollout_path ?? null
  } catch {
    return null
  } finally {
    db?.close()
  }
}
