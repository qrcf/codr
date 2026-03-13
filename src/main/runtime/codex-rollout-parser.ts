/**
 * Parses Codex rollout JSONL files into the RawSessionMessage[] format
 * that the existing renderer parseSessionMessages() understands.
 */

import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

interface RolloutLine {
  timestamp: string
  type: string
  payload: Record<string, unknown>
}

interface RolloutContent {
  type: string
  text?: string
  [key: string]: unknown
}

export interface RawSessionMessage {
  type: 'user' | 'assistant'
  uuid: string
  session_id: string
  message: {
    content: RawContentBlock[]
  }
}

export type RawContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

let _parseCounter = 0
function nextUuid(sessionId: string): string {
  return `${sessionId}-r${++_parseCounter}`
}

function isInjectedContent(text: string): boolean {
  return (
    text.startsWith('# AGENTS.md') ||
    text.startsWith('<permissions') ||
    text.startsWith('<INSTRUCTIONS>') ||
    text.startsWith('# Memory') ||
    text.startsWith('<memory') ||
    text.startsWith('<environment_context') ||
    (text.startsWith('#') && text.includes('instructions for /'))
  )
}

export async function parseCodexRollout(rolloutPath: string, sessionId: string): Promise<RawSessionMessage[]> {
  const lines = await readJsonlLines(rolloutPath)
  const messages: RawSessionMessage[] = []

  const toolOutputs = new Map<string, string>()
  for (const line of lines) {
    const p = line.payload
    if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
      const callId = p.call_id as string
      const output = p.output as string ?? ''
      if (callId) toolOutputs.set(callId, output)
    }
  }

  let pendingAssistantText = ''
  const pendingToolUses: Array<{ type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }> = []
  const pendingToolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = []

  function flushAssistant(): void {
    const content: RawContentBlock[] = []
    if (pendingAssistantText.trim()) {
      content.push({ type: 'text', text: pendingAssistantText.trim() })
    }
    content.push(...pendingToolUses)
    if (content.length > 0) {
      messages.push({
        type: 'assistant',
        uuid: nextUuid(sessionId),
        session_id: sessionId,
        message: { content },
      })
    }
    pendingAssistantText = ''
    pendingToolUses.length = 0
  }

  function flushToolResults(): void {
    if (pendingToolResults.length === 0) return
    messages.push({
      type: 'user',
      uuid: nextUuid(sessionId),
      session_id: sessionId,
      message: { content: [...pendingToolResults] },
    })
    pendingToolResults.length = 0
  }

  for (const line of lines) {
    const p = line.payload
    const itemType = p.type as string

    if (itemType === 'message') {
      const role = p.role as string
      const content = (p.content as RolloutContent[]) ?? []

      if (role === 'user') {
        flushAssistant()
        flushToolResults()

        const textParts: string[] = []
        for (const block of content) {
          if (block.type === 'input_text' && typeof block.text === 'string') {
            if (!isInjectedContent(block.text)) {
              textParts.push(block.text)
            }
          }
        }
        const text = textParts.join('\n').trim()
        if (text) {
          messages.push({
            type: 'user',
            uuid: nextUuid(sessionId),
            session_id: sessionId,
            message: { content: [{ type: 'text', text }] },
          })
        }
      } else if (role === 'assistant') {
        for (const block of content) {
          if (block.type === 'output_text' && typeof block.text === 'string' && block.text.trim()) {
            if (pendingAssistantText) pendingAssistantText += '\n'
            pendingAssistantText += block.text
          }
        }
      }
    } else if (itemType === 'function_call' || itemType === 'custom_tool_call') {
      const callId = p.call_id as string
      const name = p.name as string
      let input: Record<string, unknown> = {}

      if (itemType === 'function_call') {
        const rawArgs = p.arguments as string | undefined
        if (rawArgs) {
          try { input = JSON.parse(rawArgs) as Record<string, unknown> } catch { input = { _raw: rawArgs } }
        }
      } else {
        const rawInput = p.input as string | Record<string, unknown> | undefined
        if (typeof rawInput === 'string') {
          input = { _raw: rawInput }
        } else if (rawInput && typeof rawInput === 'object') {
          input = rawInput
        }
      }

      if (callId && name) {
        pendingToolUses.push({ type: 'tool_use', id: callId, name, input })
        const output = toolOutputs.get(callId)
        if (output !== undefined) {
          pendingToolResults.push({ type: 'tool_result', tool_use_id: callId, content: output })
        }
      }
    }
  }

  flushAssistant()
  flushToolResults()

  return messages
}

async function readJsonlLines(filePath: string): Promise<RolloutLine[]> {
  return new Promise((resolve, reject) => {
    const lines: RolloutLine[] = []
    const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity })
    rl.on('line', (line) => {
      const trimmed = line.trim()
      if (!trimmed) return
      try {
        const obj = JSON.parse(trimmed) as RolloutLine
        if (obj && typeof obj === 'object' && obj.type && obj.payload) {
          lines.push(obj)
        }
      } catch {
        // Skip malformed lines
      }
    })
    rl.on('close', () => resolve(lines))
    rl.on('error', reject)
  })
}
