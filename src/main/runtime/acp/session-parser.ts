import type { AgentProviderId } from '../../../shared/provider-types'
import { ToolCallState } from './tool-call-state'
import { normalizeAcpTool } from './normalizer'
import { extractToolResult } from './stream-adapter'

/**
 * Detect whether stored session messages are in ACP SessionUpdate format
 * (as opposed to the legacy Claude SDK format).
 */
export function isAcpSessionFormat(messages: unknown[]): boolean {
  if (messages.length === 0) return false
  // ACP events have a sessionUpdate field — check beyond the first message
  // since the provider stores injected_context and user messages first
  return messages.some(msg =>
    msg && typeof msg === 'object' && 'sessionUpdate' in msg
  )
}

interface StoredAcpEvent {
  sessionUpdate: string
  toolCallId?: string
  title?: string
  kind?: string
  status?: string
  rawInput?: unknown
  rawOutput?: unknown
  content?: Array<{ type: string; [key: string]: unknown }>
  locations?: Array<{ path: string; line?: number | null }>
  _meta?: Record<string, unknown>
  entries?: Array<{ content: string; status: string; priority?: string }>
  [key: string]: unknown
}

/**
 * Convert stored ACP SessionUpdate events into RawSessionMessage[] format
 * that sessionParser.ts can consume. Preserves all ACP fields on tool_use blocks.
 */
export function parseAcpSession(
  sessionId: string,
  _providerId: AgentProviderId,
  storedMessages: unknown[],
): unknown[] {
  const result: unknown[] = []

  // Accumulate text/thinking between tool calls to build assistant messages
  let agentText = ''
  let reasoningText = ''
  const toolCallState = new ToolCallState()
  const toolUseBlocks: Array<{
    id: string
    name: string
    kind: string
    title: string
    input: Record<string, unknown>
    content?: Array<{ type: string; [key: string]: unknown }>
    locations?: Array<{ path: string; line?: number | null }>
    rawInput?: unknown
    rawOutput?: unknown
    meta?: Record<string, unknown>
  }> = []
  const toolResultBlocks: Array<{ tool_use_id: string; content: string; is_error: boolean }> = []

  function flushTurn() {
    const assistantContent: unknown[] = []

    if (reasoningText) {
      assistantContent.push({ type: 'thinking', thinking: reasoningText })
    }
    if (agentText) {
      assistantContent.push({ type: 'text', text: agentText })
    }
    for (const block of toolUseBlocks) {
      assistantContent.push({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        kind: block.kind,
        title: block.title,
        input: block.input,
        content: block.content,
        locations: block.locations,
        rawInput: block.rawInput,
        rawOutput: block.rawOutput,
        meta: block.meta,
      })
    }

    if (assistantContent.length > 0) {
      result.push({
        type: 'assistant',
        session_id: sessionId,
        message: { content: assistantContent },
      })
    }

    if (toolResultBlocks.length > 0) {
      result.push({
        type: 'user',
        session_id: sessionId,
        message: {
          content: toolResultBlocks.map(b => ({ type: 'tool_result', ...b })),
        },
      })
    }

    agentText = ''
    reasoningText = ''
    toolUseBlocks.length = 0
    toolResultBlocks.length = 0
    toolCallState.clear()
  }

  for (const raw of storedMessages) {
    const event = raw as StoredAcpEvent

    // Pass through non-ACP messages (e.g. injected_context, synthetic user prompts)
    if (!event.sessionUpdate) {
      result.push(raw)
      continue
    }

    switch (event.sessionUpdate) {
      case 'agent_message_chunk': {
        const text = extractText(event)
        if (text) agentText += text
        break
      }
      case 'agent_thought_chunk': {
        const text = extractText(event)
        if (text) reasoningText += text
        break
      }
      case 'user_message_chunk': {
        // Flush any accumulated assistant content before user message
        flushTurn()
        const text = extractText(event)
        if (text) {
          result.push({
            type: 'user',
            session_id: sessionId,
            message: { content: [{ type: 'text', text }] },
          })
        }
        break
      }
      case 'tool_call': {
        const { toolCallId, title, rawInput, rawOutput, status, kind, content, locations, _meta } = event
        if (toolCallId) {
          toolCallState.remember(toolCallId, {
            kind,
            title,
            rawInput,
            rawOutput,
            meta: _meta as Record<string, unknown> | undefined,
          })
        }
        if (status === 'completed' || status === 'failed') {
          const resolved = toolCallState.resolve(toolCallId!, {
            kind,
            title,
            rawInput,
            rawOutput,
            meta: _meta as Record<string, unknown> | undefined,
          })
          const locs = locations as Array<{ path: string; line?: number | null }> | undefined
          const normalized = normalizeAcpTool(
            resolved.kind, resolved.title,
            (resolved.rawInput as Record<string, unknown>) || {},
            locs,
          )
          const contentArr = content as Array<{ type: string; [key: string]: unknown }> | undefined
          const output = extractToolResult(contentArr, resolved.rawOutput)

          toolUseBlocks.push({
            id: toolCallId!,
            name: normalized.kind,
            kind: normalized.kind,
            title: resolved.title,
            input: normalized.input,
            content: contentArr,
            locations: locs,
            rawInput: resolved.rawInput,
            rawOutput: resolved.rawOutput,
            meta: resolved.meta,
          })
          toolResultBlocks.push({
            tool_use_id: toolCallId!,
            content: output,
            is_error: status === 'failed',
          })
        }
        break
      }
      case 'tool_call_update': {
        const { toolCallId, status, rawInput, rawOutput, content: tcContent, kind, title, locations, _meta } = event
        if (status === 'completed' || status === 'failed') {
          const resolved = toolCallState.resolve(toolCallId!, {
            kind,
            title,
            rawInput,
            rawOutput,
            meta: _meta as Record<string, unknown> | undefined,
          })
          const locs = locations as Array<{ path: string; line?: number | null }> | undefined
          const normalized = normalizeAcpTool(
            resolved.kind, resolved.title,
            (resolved.rawInput as Record<string, unknown>) || {},
            locs,
          )

          const tcContentArr = tcContent as Array<{ type: string; [key: string]: unknown }> | undefined
          const outputText = extractToolResult(tcContentArr, resolved.rawOutput)

          // Update existing block or add new one
          const existing = toolUseBlocks.find(b => b.id === toolCallId)
          if (existing) {
            existing.name = normalized.kind
            existing.kind = normalized.kind
            existing.title = resolved.title
            existing.input = normalized.input
            if (tcContentArr) existing.content = tcContentArr
            if (locs) existing.locations = locs
            if (resolved.rawInput !== undefined) existing.rawInput = resolved.rawInput
            if (resolved.rawOutput !== undefined) existing.rawOutput = resolved.rawOutput
            if (resolved.meta) existing.meta = resolved.meta
            // Update the result block too
            const existingResult = toolResultBlocks.find(b => b.tool_use_id === toolCallId)
            if (existingResult) {
              existingResult.content = outputText
              existingResult.is_error = status === 'failed'
            }
          } else {
            toolUseBlocks.push({
              id: toolCallId!,
              name: normalized.kind,
              kind: normalized.kind,
              title: resolved.title,
              input: normalized.input,
              content: tcContentArr,
              locations: locs,
              rawInput: resolved.rawInput,
              rawOutput: resolved.rawOutput,
              meta: resolved.meta,
            })
            toolResultBlocks.push({
              tool_use_id: toolCallId!,
              content: outputText,
              is_error: status === 'failed',
            })
          }
        }
        break
      }
      case 'plan': {
        const toolId = `plan-${Date.now()}`
        const input = {
          todos: (event.entries || []).map(entry => ({
            content: entry.content,
            status: entry.status || 'pending',
            activeForm: entry.content,
          })),
        }
        toolUseBlocks.push({
          id: toolId,
          name: 'TodoWrite',
          kind: 'TodoWrite',
          title: 'TodoWrite',
          input,
        })
        toolResultBlocks.push({
          tool_use_id: toolId,
          content: 'Plan updated',
          is_error: false,
        })
        break
      }
      // session_info_update, usage_update, config_option_update etc. — not chat messages
    }
  }

  // Flush remaining accumulated content
  flushTurn()

  return result
}

function extractText(event: StoredAcpEvent): string {
  // ACP content block is at event.content for message chunks
  const content = event.content as unknown
  if (content && typeof content === 'object' && 'type' in (content as Record<string, unknown>)) {
    const block = content as { type: string; text?: string }
    if (block.type === 'text' && block.text) return block.text
  }
  return ''
}
