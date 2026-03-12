import { ipcMain } from 'electron'
import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import type { EventBroadcaster } from './event-broadcaster'

export type MessageOrigin = 'local' | 'remote'

const DENY: PermissionResult = { behavior: 'deny', message: 'Denied by user' }

/** Build an allow result — always includes updatedInput to satisfy SDK Zod schema */
function allow(input: unknown): PermissionResult {
  return { behavior: 'allow', updatedInput: input as Record<string, unknown> }
}

// Read-only tools that are always auto-approved
// NOTE: AskUserQuestion is NOT here — it requires user interaction
// and must return { updatedInput } to the SDK.
const READ_ONLY_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
  'TodoWrite',
  'Agent',
  'EnterPlanMode',
])

// Edit tools gated by the autoApproveEdits setting
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

// Read-only bash command prefixes that are auto-approved
const READ_ONLY_BASH_PREFIXES = [
  'ls', 'pwd', 'echo', 'cat', 'head', 'tail', 'wc', 'which', 'whoami',
  'date', 'env', 'printenv', 'uname', 'file', 'stat', 'du', 'df',
  'find', 'grep', 'rg', 'ag', 'tree',
  'git status', 'git log', 'git diff', 'git show', 'git branch',
  'git remote', 'git tag', 'git rev-parse', 'git ls-files',
]

interface PermissionSettings {
  autoApproveEdits: boolean
  bashWhitelist: string[]
  trustRemotePermissions: boolean
  remoteQueryPolicy: 'full' | 'ask-all' | 'ask-mode'
}

// Settings that cannot be changed from remote origins
const SECURITY_CRITICAL_KEYS = new Set<keyof PermissionSettings>([
  'autoApproveEdits',
  'bashWhitelist',
  'trustRemotePermissions',
  'remoteQueryPolicy',
])

const settings: PermissionSettings = {
  autoApproveEdits: false,
  bashWhitelist: ['ls', 'pwd', 'echo', 'git', 'node', 'pnpm', 'npm', 'npx', 'tsc'],
  trustRemotePermissions: false,
  remoteQueryPolicy: 'ask-all',
}

let permissionIdCounter = 0
const pendingPermissions = new Map<number, {
  resolve: (allowed: boolean, message?: string) => void
}>()

const pendingQuestions = new Map<number, {
  resolve: (answers: Record<string, string>) => void
}>()

// Per-query "always allow" cache — tool types approved by the user with "Always Allow"
const sessionApprovedTools = new Set<string>()

function extractBashCommand(input: Record<string, unknown>): string {
  const cmd = (input.command as string) || ''
  return cmd.trim()
}

function isBashReadOnly(command: string): boolean {
  return READ_ONLY_BASH_PREFIXES.some(
    (prefix) => command === prefix || command.startsWith(prefix + ' '),
  )
}

function isBashWhitelisted(command: string): boolean {
  const firstWord = command.split(/\s/)[0]
  return settings.bashWhitelist.includes(firstWord)
}

/**
 * Resolve a pending permission request.
 * When origin is 'remote' and trustRemotePermissions is false, the response
 * is silently dropped — the pending permission stays for the desktop user.
 */
export function resolvePermission(id: number, allowed: boolean, message?: string, origin: MessageOrigin = 'local') {
  const pending = pendingPermissions.get(id)
  if (!pending) return

  if (origin === 'remote' && !settings.trustRemotePermissions) {
    console.warn(`[security] Dropped remote permission response for id=${id} (trustRemotePermissions is off)`)
    return
  }

  pending.resolve(allowed, message)
  pendingPermissions.delete(id)
}

/**
 * Resolve a pending question request with user's answers.
 */
export function resolveQuestion(id: number, answers: Record<string, string>) {
  const pending = pendingQuestions.get(id)
  if (pending) {
    pending.resolve(answers)
    pendingQuestions.delete(id)
  }
}

/** Clear the per-query approval cache. Call at the start of each new query. */
export function resetSessionApprovals() {
  sessionApprovedTools.clear()
}

/** Mark a tool type as always-allowed for this query session. */
export function approveToolForSession(toolName: string, origin: MessageOrigin = 'local') {
  if (origin === 'remote' && !settings.trustRemotePermissions) {
    console.warn(`[security] Dropped remote "always allow" for tool=${toolName} (trustRemotePermissions is off)`)
    return
  }
  sessionApprovedTools.add(toolName)
}

export function createCanUseTool(
  broadcaster: EventBroadcaster,
  getQuerySessionId?: () => string | null,
  askMode?: boolean,
  origin: MessageOrigin = 'local',
): CanUseTool {
  const ASK_MODE_DENY: PermissionResult = { behavior: 'deny', message: 'Edits are not allowed in Ask mode' }

  // Apply remote query policy — force ask-mode or ask-all for remote queries
  const effectiveAskMode = askMode || (origin === 'remote' && settings.remoteQueryPolicy === 'ask-mode')
  const askAll = origin === 'remote' && settings.remoteQueryPolicy === 'ask-all'

  return async (toolName, input, _options) => {
    const qsid = getQuerySessionId?.() ?? null

    // AskUserQuestion: intercept and prompt user for answers
    if (toolName === 'AskUserQuestion') {
      return promptQuestion(broadcaster, input as Record<string, unknown>, qsid)
    }

    // ExitPlanMode: prompt user for plan approval (blocking), must return updatedInput
    if (toolName === 'ExitPlanMode') {
      const id = ++permissionIdCounter
      broadcaster.send('agent:permission-request', { id, tool: toolName, input: input as Record<string, unknown> }, qsid)
      return new Promise((resolve) => {
        pendingPermissions.set(id, {
          resolve: (allowed, message?) => resolve(
            allowed
              ? { behavior: 'allow', updatedInput: input as Record<string, unknown> }
              : { behavior: 'deny', message: message || 'User requested changes to the plan' }
          ),
        })
      })
    }

    // Ask mode: block all edit/write tools
    if (effectiveAskMode) {
      if (EDIT_TOOLS.has(toolName)) return ASK_MODE_DENY
      if (toolName === 'Bash') {
        const command = extractBashCommand(input as Record<string, unknown>)
        if (!isBashReadOnly(command)) return ASK_MODE_DENY
        return allow(input)
      }
    }

    // Auto-approve read-only tools
    if (READ_ONLY_TOOLS.has(toolName)) {
      return allow(input)
    }

    // Per-query "always allow" cache (skip for remote ask-all queries)
    if (sessionApprovedTools.has(toolName) && !askAll) {
      return allow(input)
    }

    // Edit tools: gated by setting
    if (EDIT_TOOLS.has(toolName)) {
      // Remote ask-all: always prompt, ignore autoApproveEdits
      if (settings.autoApproveEdits && !askAll) {
        return allow(input)
      }
      return promptUser(broadcaster, toolName, input as Record<string, unknown>, qsid)
    }

    // Bash: check read-only patterns, then whitelist, then prompt
    if (toolName === 'Bash') {
      const command = extractBashCommand(input as Record<string, unknown>)
      if (isBashReadOnly(command)) {
        return allow(input)
      }
      // Remote ask-all: skip whitelist auto-approve, always prompt
      if (isBashWhitelisted(command) && !askAll) {
        return allow(input)
      }
      return promptUser(broadcaster, toolName, input as Record<string, unknown>, qsid)
    }

    // Unknown tools: prompt
    return promptUser(broadcaster, toolName, input as Record<string, unknown>, qsid)
  }
}

async function promptUser(
  broadcaster: EventBroadcaster,
  toolName: string,
  input: Record<string, unknown>,
  querySessionId: string | null,
): Promise<PermissionResult> {
  const id = ++permissionIdCounter
  broadcaster.send('agent:permission-request', { id, tool: toolName, input }, querySessionId)

  return new Promise((resolve) => {
    pendingPermissions.set(id, {
      resolve: (allowed) => resolve(allowed ? allow(input) : DENY),
    })
  })
}

async function promptQuestion(
  broadcaster: EventBroadcaster,
  input: Record<string, unknown>,
  querySessionId: string | null,
): Promise<PermissionResult> {
  const id = ++permissionIdCounter
  broadcaster.send('agent:question-request', { id, questions: input.questions }, querySessionId)

  const answers = await new Promise<Record<string, string>>((resolve) => {
    pendingQuestions.set(id, { resolve })
  })

  return { behavior: 'allow', updatedInput: { ...input, answers } }
}

export function updateSettings(update: Partial<PermissionSettings>, origin: MessageOrigin = 'local') {
  if (origin === 'remote') {
    // Filter out security-critical keys from remote updates
    const blocked = Object.keys(update).filter(k => SECURITY_CRITICAL_KEYS.has(k as keyof PermissionSettings))
    if (blocked.length > 0) {
      console.warn(`[security] Blocked remote settings update for: ${blocked.join(', ')}`)
    }
    // Strip out all security-critical keys — currently all settings are security-critical,
    // so remote settings_update is effectively a no-op. When non-security settings are
    // added in the future, they will pass through here.
    for (const key of SECURITY_CRITICAL_KEYS) {
      delete (update as Record<string, unknown>)[key]
    }
    if (Object.keys(update).length === 0) return
  }

  if (update.autoApproveEdits !== undefined) {
    settings.autoApproveEdits = update.autoApproveEdits
  }
  if (update.bashWhitelist !== undefined) {
    settings.bashWhitelist = update.bashWhitelist
  }
  if (update.trustRemotePermissions !== undefined) {
    settings.trustRemotePermissions = update.trustRemotePermissions
  }
  if (update.remoteQueryPolicy !== undefined) {
    settings.remoteQueryPolicy = update.remoteQueryPolicy
  }
}

export function registerPermissionHandlers(broadcaster: EventBroadcaster) {
  ipcMain.on('agent:permission-response', (_event, data: { id: number; allowed: boolean; alwaysAllow?: boolean; toolName?: string; message?: string }) => {
    if (data.alwaysAllow && data.toolName) {
      approveToolForSession(data.toolName)
    }
    resolvePermission(data.id, data.allowed, data.message)
    broadcaster.clearPermissionRequest(data.id)
  })

  ipcMain.on('agent:question-response', (_event, data: { id: number; answers: Record<string, string> }) => {
    resolveQuestion(data.id, data.answers)
    broadcaster.clearQuestionRequest(data.id)
  })

  ipcMain.on('agent:settings-update', (_event, update: Partial<PermissionSettings>) => {
    updateSettings(update)
  })
}
