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
  querySessionId: string | null
  resolve: (allowed: boolean, message?: string) => void
  reject: (reason?: string) => void
}>()

const pendingQuestions = new Map<number, {
  querySessionId: string | null
  resolve: (answers: Record<string, string>) => void
  reject: (reason?: string) => void
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

// ---------------------------------------------------------------------------
// Shared permission evaluation — used by both Claude SDK and ACP providers
// ---------------------------------------------------------------------------

/** Provider-agnostic permission categories */
export type PermissionCategory =
  | 'read_only'     // Always auto-approved
  | 'edit'          // Gated by autoApproveEdits setting
  | 'command'       // Bash/execute — checked against read-only patterns and whitelist
  | 'switch_mode'   // Plan exit — special flow (handled by caller before evaluatePermission)
  | 'ask_question'  // User question intercept (handled by caller before evaluatePermission)
  | 'unknown'       // Prompt user

/** Result of evaluating a tool permission */
export type PermissionDecision =
  | { action: 'allow' }
  | { action: 'deny'; message: string }
  | { action: 'prompt' }

/** Classify a Claude SDK tool name into a permission category */
export function classifySdkTool(toolName: string): PermissionCategory {
  if (toolName === 'AskUserQuestion') return 'ask_question'
  if (toolName === 'ExitPlanMode') return 'switch_mode'
  if (READ_ONLY_TOOLS.has(toolName)) return 'read_only'
  if (EDIT_TOOLS.has(toolName)) return 'edit'
  if (toolName === 'Bash') return 'command'
  // Auto-approve our own read-only MCP tools (docs_search, codebase_search)
  if (toolName.startsWith('mcp__codr-tools__')) return 'read_only'
  return 'unknown'
}

/** Classify an ACP tool kind into a permission category */
export function classifyAcpTool(kind: string | null | undefined): PermissionCategory {
  switch (kind) {
    case 'read':
    case 'search':
    case 'think':
    case 'fetch':
      return 'read_only'
    case 'edit':
    case 'delete':
    case 'move':
      return 'edit'
    case 'execute':
      return 'command'
    case 'switch_mode':
      return 'switch_mode'
    default:
      return 'unknown'
  }
}

/** Compute effective ask mode accounting for remote query policy */
export function getEffectiveAskMode(askMode: boolean, origin: MessageOrigin): boolean {
  return askMode || (origin === 'remote' && settings.remoteQueryPolicy === 'ask-mode')
}

/** Check if remote ask-all policy is active */
export function isAskAll(origin: MessageOrigin): boolean {
  return origin === 'remote' && settings.remoteQueryPolicy === 'ask-all'
}

/**
 * Core permission evaluation — provider-agnostic.
 * Callers must handle 'switch_mode' and 'ask_question' categories BEFORE calling this.
 *
 * @param category  - The PermissionCategory of the tool
 * @param toolName  - Display name used for session "always allow" cache lookup
 * @param command   - For 'command' category: the raw command string (null if not extractable)
 * @param askMode   - Whether ask mode is active (use getEffectiveAskMode)
 * @param askAll    - Whether remote ask-all policy is active (use isAskAll)
 */
export function evaluatePermission(
  category: PermissionCategory,
  toolName: string,
  command: string | null,
  askMode: boolean,
  askAll: boolean,
): PermissionDecision {
  // Ask mode: block mutations
  if (askMode) {
    if (category === 'edit') {
      return { action: 'deny', message: 'Edits are not allowed in Ask mode' }
    }
    if (category === 'command') {
      if (command && isBashReadOnly(command)) {
        return { action: 'allow' }
      }
      return { action: 'deny', message: 'Edits are not allowed in Ask mode' }
    }
  }

  // Read-only: always auto-approve
  if (category === 'read_only') {
    return { action: 'allow' }
  }

  // Per-session "always allow" cache (skip for remote ask-all)
  if (sessionApprovedTools.has(toolName) && !askAll) {
    return { action: 'allow' }
  }

  // Edit tools: gated by setting
  if (category === 'edit') {
    if (settings.autoApproveEdits && !askAll) {
      return { action: 'allow' }
    }
    return { action: 'prompt' }
  }

  // Command execution: check read-only patterns, then whitelist, then prompt
  if (category === 'command') {
    if (command) {
      if (isBashReadOnly(command)) {
        return { action: 'allow' }
      }
      if (isBashWhitelisted(command) && !askAll) {
        return { action: 'allow' }
      }
    }
    return { action: 'prompt' }
  }

  // Unknown: prompt
  return { action: 'prompt' }
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
 * Register a pending permission in the shared system (used by Cursor provider).
 * Returns a unique ID and a promise that resolves when the user responds.
 */
export function registerPendingPermission(sessionId: string | null): {
  id: number
  promise: Promise<{ allowed: boolean; message?: string }>
} {
  const id = ++permissionIdCounter
  const promise = new Promise<{ allowed: boolean; message?: string }>((resolve, reject) => {
    pendingPermissions.set(id, {
      querySessionId: sessionId,
      resolve: (allowed, message?) => resolve({ allowed, message }),
      reject: (reason?) => reject(new Error(reason || 'Session interrupted')),
    })
  })
  return { id, promise }
}

/**
 * Register a pending question in the shared system (used by Cursor provider).
 * Returns a unique ID and a promise that resolves when the user answers.
 */
export function registerPendingQuestion(sessionId: string | null): {
  id: number
  promise: Promise<Record<string, string>>
} {
  const id = ++permissionIdCounter
  const promise = new Promise<Record<string, string>>((resolve, reject) => {
    pendingQuestions.set(id, {
      querySessionId: sessionId,
      resolve,
      reject: (reason?) => reject(new Error(reason || 'Session interrupted')),
    })
  })
  return { id, promise }
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

export function rejectPendingForSession(sessionId: string, reason: string): {
  permissionIds: number[]
  questionIds: number[]
} {
  const permissionIds: number[] = []
  const questionIds: number[] = []

  for (const [id, pending] of pendingPermissions.entries()) {
    if (pending.querySessionId !== sessionId) continue
    pending.reject(reason)
    pendingPermissions.delete(id)
    permissionIds.push(id)
  }

  for (const [id, pending] of pendingQuestions.entries()) {
    if (pending.querySessionId !== sessionId) continue
    pending.reject(reason)
    pendingQuestions.delete(id)
    questionIds.push(id)
  }

  return { permissionIds, questionIds }
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
  const effectiveAskMode = getEffectiveAskMode(askMode || false, origin)
  const askAll = isAskAll(origin)

  return async (toolName, input, options) => {
    void options
    const qsid = getQuerySessionId?.() ?? null

    // AskUserQuestion: intercept and prompt user for answers
    if (toolName === 'AskUserQuestion') {
      return promptQuestion(broadcaster, input as Record<string, unknown>, qsid)
    }

    // ExitPlanMode: prompt user for plan approval (blocking), must return updatedInput
    if (toolName === 'ExitPlanMode') {
      const id = ++permissionIdCounter
      broadcaster.send('agent:permission-request', { id, tool: toolName, input: input as Record<string, unknown> }, qsid)
      return new Promise((resolve, reject) => {
        pendingPermissions.set(id, {
          querySessionId: qsid,
          resolve: (allowed, message?) => resolve(
            allowed
              ? { behavior: 'allow', updatedInput: input as Record<string, unknown> }
              : { behavior: 'deny', message: message || 'User requested changes to the plan' }
          ),
          reject: (reason?: string) => reject(new Error(reason || 'Session interrupted')),
        })
      })
    }

    // Classify and evaluate using shared logic
    const category = classifySdkTool(toolName)
    const command = toolName === 'Bash' ? extractBashCommand(input as Record<string, unknown>) : null
    const decision = evaluatePermission(category, toolName, command, effectiveAskMode, askAll)

    switch (decision.action) {
      case 'allow':
        return allow(input)
      case 'deny':
        return { behavior: 'deny', message: decision.message }
      case 'prompt':
        return promptUser(broadcaster, toolName, input as Record<string, unknown>, qsid)
    }
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
      querySessionId,
      resolve: (allowed) => resolve(allowed ? allow(input) : DENY),
      reject: (reason?: string) => resolve({ behavior: 'deny', message: reason || 'Session interrupted' }),
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

  const answers = await new Promise<Record<string, string>>((resolve, reject) => {
    pendingQuestions.set(id, {
      querySessionId,
      resolve,
      reject: (reason?: string) => reject(new Error(reason || 'Session interrupted')),
    })
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
