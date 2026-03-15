import test from 'node:test'
import assert from 'node:assert/strict'
import { EventBroadcaster } from './event-broadcaster'

test('forceCleanup removes stuck conversation state', () => {
  const broadcaster = new EventBroadcaster(() => null)

  broadcaster.markQueryStart('session-1', 'hello')
  assert.equal(broadcaster.hasActiveQueries(), true)

  broadcaster.forceCleanup('session-1', 'interrupted')

  assert.equal(broadcaster.hasActiveQueries(), false)
  assert.equal(broadcaster.getState('session-1').isLoading, false)
  assert.deepEqual(broadcaster.getState('session-1').messages, [])
})
