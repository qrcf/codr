import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAcpSession } from './session-parser'

test('parseAcpSession preserves initial tool metadata when completion update omits it', () => {
  const messages = parseAcpSession('session-1', 'cursor', [
    {
      sessionUpdate: 'tool_call',
      toolCallId: 'tool-1',
      kind: 'search',
      title: 'glob_file_search',
      status: 'in_progress',
      rawInput: { pattern: '**/*.png' },
      _meta: { source: 'initial' },
    },
    {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tool-1',
      status: 'completed',
      rawOutput: { totalFiles: 3, truncated: false },
    },
  ])

  const assistant = messages.find((message): message is { type: 'assistant'; message: { content: Array<Record<string, unknown>> } } => {
    return !!message && typeof message === 'object' && 'type' in message && (message as { type?: string }).type === 'assistant'
  })

  assert.ok(assistant)
  assert.equal(assistant.message.content.length, 1)

  const tool = assistant.message.content[0]
  assert.equal(tool.type, 'tool_use')
  assert.equal(tool.kind, 'search')
  assert.equal(tool.title, 'glob_file_search')
  assert.deepEqual(tool.input, { pattern: '**/*.png' })
  assert.deepEqual(tool.rawInput, { pattern: '**/*.png' })
  assert.deepEqual(tool.rawOutput, { totalFiles: 3, truncated: false })
  assert.deepEqual(tool.meta, { source: 'initial' })
})
