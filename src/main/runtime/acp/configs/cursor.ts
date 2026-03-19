import type { AcpAgentConfig, AcpExtensionHandler } from '../agent-config'
import type { ModelOption } from '../../models'

// --- Extension handlers ---

const handleCreatePlan: AcpExtensionHandler = async (sessionId, params, ctx) => {
  // Cursor-specific plan creation — show plan review dialog
  // Prefer params.plan (full markdown) over sparse plan entries
  const p = params as { name?: string; overview?: string; plan?: string }
  const planContent = p.plan
    || ctx.adapter.getPendingPlanEntries().map(e => `- [${e.status}] ${e.content}`).join('\n')
    || JSON.stringify(params, null, 2)

  const { id: permId, promise } = ctx.registerPendingPermission(sessionId)
  ctx.broadcaster.send('agent:permission-request', {
    id: permId,
    tool: 'ExitPlanMode',
    input: {
      plan: planContent,
      planContent,
      planFilePath: `cursor://plan/${sessionId}`,
      planTitle: p.name || undefined,
      provider: 'cursor',
    },
  }, sessionId)

  const { allowed, message } = await promise
  if (!allowed) return { feedback: message || 'User requested changes' }
  return { approved: true }
}

const handleAskQuestion: AcpExtensionHandler = async (sessionId, params, ctx) => {
  const qParams = params as { questions?: Array<{ id: string; text: string; options?: Array<{ id: string; text: string }> }> }
  if (!qParams.questions || qParams.questions.length === 0) return {}

  const { id, promise } = ctx.registerPendingQuestion(sessionId)
  ctx.broadcaster.send('agent:question-request', {
    id,
    questions: qParams.questions,
  }, sessionId)

  const answers = await promise
  return { answers }
}

const handleUpdateTodos: AcpExtensionHandler = async (sessionId, params, ctx) => {
  const todoParams = params as { todos?: unknown[] }
  if (todoParams.todos) {
    ctx.callbacks.onMessage({
      type: 'assistant',
      session_id: sessionId,
      message: {
        content: [{ type: 'tool_use', id: `cursor-todo-${Date.now()}`, kind: 'other', title: 'TodoWrite', input: { todos: todoParams.todos } }],
      },
    }, sessionId)
  }
  return {}
}

// --- Model output parser ---

function parseCursorModelsOutput(stdout: string): ModelOption[] {
  const models: ModelOption[] = []
  const linePattern = /^(\S+)\s+-\s+(.+?)(?:\s+\((current|default)\))?$/
  for (const line of stdout.split('\n')) {
    const match = line.trim().match(linePattern)
    if (match) {
      models.push({
        value: match[1],
        displayName: match[2].trim(),
      })
    }
  }
  return models
}

// --- Config ---

export function createCursorConfig(): AcpAgentConfig {
  return {
    providerId: 'cursor',
    command: 'cursor',
    args: ['agent', 'acp'],
    authMethodId: 'cursor_login',
    logTag: 'cursor',
    extensionHandlers: {
      'cursor/create_plan': handleCreatePlan,
      'cursor/ask_question': handleAskQuestion,
      'cursor/update_todos': handleUpdateTodos,
    },
    modelCommand: {
      args: ['agent', 'models'],
      parseOutput: parseCursorModelsOutput,
    },
  }
}
