import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  appendIndexedSessionMessage,
  getIndexedSessionMessagesFromDb,
  initSessionIndexStorage,
  shouldPersistIndexedMessage,
} from './session-index-storage'

test('appendIndexedSessionMessage lazily migrates legacy blob rows and preserves message order', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'codr-session-index-'))
  const dbPath = path.join(tempDir, 'sessions.db')
  const db = new DatabaseSync(dbPath)

  try {
    initSessionIndexStorage(db)

    db.prepare(
      'INSERT INTO session_messages (sessionId, provider, messagesJson) VALUES (?, ?, ?)',
    ).run(
      'session-1',
      'claude',
      JSON.stringify([
        { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hello' }] } },
      ]),
    )

    appendIndexedSessionMessage(
      db,
      'session-1',
      'claude',
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'world' }] } },
    )

    const record = getIndexedSessionMessagesFromDb(db, 'session-1')

    assert.deepEqual(record, {
      provider: 'claude',
      rawMessages: [
        { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hello' }] } },
        { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'world' }] } },
      ],
    })

    const legacyRow = db.prepare(
      'SELECT sessionId FROM session_messages WHERE sessionId = ?',
    ).get('session-1')
    assert.equal(legacyRow, undefined)
  } finally {
    db.close()
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('getIndexedSessionMessagesFromDb prefers existing v2 rows when legacy and v2 data coexist', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'codr-session-index-'))
  const dbPath = path.join(tempDir, 'sessions.db')
  const db = new DatabaseSync(dbPath)

  try {
    initSessionIndexStorage(db)

    db.prepare(
      'INSERT INTO session_messages (sessionId, provider, messagesJson) VALUES (?, ?, ?)',
    ).run(
      'session-2',
      'claude',
      JSON.stringify([
        { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'legacy' }] } },
      ]),
    )

    db.prepare(
      'INSERT INTO session_messages_v2 (sessionId, provider, messageJson) VALUES (?, ?, ?)',
    ).run(
      'session-2',
      'claude',
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'v2' }] } }),
    )

    const record = getIndexedSessionMessagesFromDb(db, 'session-2')

    assert.deepEqual(record, {
      provider: 'claude',
      rawMessages: [
        { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'v2' }] } },
      ],
    })

    const legacyRow = db.prepare(
      'SELECT sessionId FROM session_messages WHERE sessionId = ?',
    ).get('session-2')
    assert.equal(legacyRow, undefined)
  } finally {
    db.close()
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('shouldPersistIndexedMessage keeps canonical chat messages and drops transient events', () => {
  assert.equal(shouldPersistIndexedMessage({ type: 'user' }), true)
  assert.equal(shouldPersistIndexedMessage({ type: 'assistant' }), true)
  assert.equal(shouldPersistIndexedMessage({ type: 'stream_event' }), false)
  assert.equal(shouldPersistIndexedMessage({ type: 'system' }), false)
  assert.equal(shouldPersistIndexedMessage({ type: 'session_snapshot' }), false)
  assert.equal(shouldPersistIndexedMessage({}), false)
})
