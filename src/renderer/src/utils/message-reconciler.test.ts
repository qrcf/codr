import test from 'node:test'
import assert from 'node:assert/strict'
import type { ChatMessage } from '../types'
import { reconcileParsedMessages } from './message-reconciler'

function assistant(id: string, content: string): ChatMessage {
  return {
    id,
    role: 'assistant',
    content,
    toolCalls: [],
  }
}

test('reconcileParsedMessages preserves existing message objects when content is unchanged', () => {
  const previous = [
    assistant('old-1', 'alpha'),
    assistant('old-2', 'beta'),
  ]
  const reparsed = [
    assistant('new-1', 'alpha'),
    assistant('new-2', 'beta'),
  ]

  const reconciled = reconcileParsedMessages(previous, reparsed)

  assert.equal(reconciled[0], previous[0])
  assert.equal(reconciled[1], previous[1])
  assert.deepEqual(reconciled.map((message) => message.id), ['old-1', 'old-2'])
})

test('reconcileParsedMessages keeps new objects when parsed message content changes', () => {
  const previous = [
    assistant('old-1', 'alpha'),
    assistant('old-2', 'beta'),
  ]
  const reparsed = [
    assistant('new-1', 'alpha'),
    assistant('new-2', 'gamma'),
  ]

  const reconciled = reconcileParsedMessages(previous, reparsed)

  assert.equal(reconciled[0], previous[0])
  assert.equal(reconciled[1], reparsed[1])
  assert.equal(reconciled[1]?.id, 'new-2')
})
