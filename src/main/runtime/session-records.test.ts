import test from 'node:test'
import assert from 'node:assert/strict'
import type { SessionInfo } from '@codr-works/types'
import {
  buildSessionList,
  resolveSessionProvider,
  shouldUseIndexedMessages,
  type IndexedSessionMessages,
  type SessionListInput,
} from './session-records.ts'

function makeClaudeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    sessionId: 'claude-1',
    summary: 'Claude summary',
    lastModified: 10,
    fileSize: 1,
    ...overrides,
  }
}

test('buildSessionList includes both providers regardless of selected provider', () => {
  const input: SessionListInput = {
    indexedSessions: [
      {
        sessionId: 'claude-1',
        provider: 'claude',
        createdAt: 1,
        updatedAt: 10,
        firstPrompt: 'Claude first prompt',
      },
      {
        sessionId: 'cursor-1',
        provider: 'cursor',
        createdAt: 2,
        updatedAt: 20,
        firstPrompt: 'Cursor first prompt',
      },
    ],
    claudeSessions: [makeClaudeSession()],
    claudeDbSessions: [],
  }

  const result = buildSessionList(input)

  assert.equal(result.sessions.length, 2)
  assert.deepEqual(
    result.sessions.map((session) => [session.sessionId, session.provider]),
    [
      ['cursor-1', 'cursor'],
      ['claude-1', 'claude'],
    ],
  )
})

test('shouldUseIndexedMessages only accepts records from the same provider', () => {
  const indexed: IndexedSessionMessages = {
    provider: 'claude',
    rawMessages: [{ type: 'assistant' }],
  }

  assert.equal(shouldUseIndexedMessages(indexed, 'claude'), true)
  assert.equal(shouldUseIndexedMessages(indexed, 'cursor'), false)
  assert.equal(shouldUseIndexedMessages(null, 'claude'), false)
})

test('resolveSessionProvider prefers the stored session provider over current selection', () => {
  assert.equal(resolveSessionProvider('cursor', 'claude'), 'claude')
  assert.equal(resolveSessionProvider('claude', 'cursor'), 'cursor')
  assert.equal(resolveSessionProvider('claude', undefined), 'claude')
})

test('buildSessionList preserves Claude SDK recency over refreshed index timestamps', () => {
  const result = buildSessionList({
    indexedSessions: [
      {
        sessionId: 'claude-1',
        provider: 'claude',
        createdAt: 1,
        updatedAt: 9999,
        firstPrompt: 'Indexed prompt',
      },
    ],
    claudeSessions: [
      makeClaudeSession({
        sessionId: 'claude-1',
        lastModified: 123,
      }),
    ],
    claudeDbSessions: [],
  })

  assert.equal(result.sessions[0]?.lastModified, 123)
})

test('buildSessionList keeps SDK summary distinct from indexed generated title', () => {
  const result = buildSessionList({
    indexedSessions: [
      {
        sessionId: 'claude-1',
        provider: 'claude',
        createdAt: 1,
        updatedAt: 10,
        firstPrompt: 'Test Message Containing Numbers',
        title: 'Test Message Containing Numbers',
      },
    ],
    claudeSessions: [
      makeClaudeSession({
        sessionId: 'claude-1',
        summary: 'SDK summary from provider',
      }),
    ],
    claudeDbSessions: [],
  })

  assert.equal(result.sessions[0]?.generatedTitle, 'Test Message Containing Numbers')
  assert.equal(result.sessions[0]?.summary, 'SDK summary from provider')
})
