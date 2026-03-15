import test from 'node:test'
import assert from 'node:assert/strict'
import { getHeaderSessionTitle, hasStableSessionTitle } from './session-title.ts'

function makeSession(overrides: Partial<Pick<SessionInfo, 'customTitle' | 'generatedTitle' | 'firstPrompt'>> = {}): Pick<SessionInfo, 'customTitle' | 'generatedTitle' | 'firstPrompt'> {
  return {
    customTitle: undefined,
    generatedTitle: undefined,
    firstPrompt: undefined,
    ...overrides,
  }
}

test('getHeaderSessionTitle keeps placeholder while pending', () => {
  assert.equal(
    getHeaderSessionTitle(makeSession({ firstPrompt: 'Build a thing' }), true),
    'New Chat',
  )
})

test('getHeaderSessionTitle hides prompt-derived titles when not pending', () => {
  assert.equal(
    getHeaderSessionTitle(makeSession({ generatedTitle: 'Build a thing', firstPrompt: 'Build a thing' }), false),
    null,
  )
})

test('hasStableSessionTitle ignores prompt-derived titles', () => {
  assert.equal(
    hasStableSessionTitle(makeSession({ customTitle: 'Build a thing', firstPrompt: 'Build a thing' })),
    false,
  )
})

test('hasStableSessionTitle accepts distinct generated titles', () => {
  assert.equal(
    hasStableSessionTitle(makeSession({ generatedTitle: 'Implement auth flow', firstPrompt: 'Build a thing' })),
    true,
  )
})
