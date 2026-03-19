import test from 'node:test'
import assert from 'node:assert/strict'
import { ToolCallState } from './tool-call-state'

test('ToolCallState resolves completion updates from stored initial metadata', () => {
  const state = new ToolCallState()

  state.remember('tool-1', {
    kind: 'search',
    title: 'glob_file_search',
    rawInput: { pattern: '**/*.png' },
    meta: { source: 'initial' },
  })

  const resolved = state.resolve('tool-1', {
    rawOutput: { totalFiles: 3, truncated: false },
  })

  assert.equal(resolved.kind, 'search')
  assert.equal(resolved.title, 'glob_file_search')
  assert.deepEqual(resolved.rawInput, { pattern: '**/*.png' })
  assert.deepEqual(resolved.rawOutput, { totalFiles: 3, truncated: false })
  assert.deepEqual(resolved.meta, { source: 'initial' })
})
