import { ipcMain, type BrowserWindow } from 'electron'
import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk'

const ALLOW: PermissionResult = { behavior: 'allow' }
const DENY: PermissionResult = { behavior: 'deny', message: 'Denied by user' }

// Read-only tools that are always auto-approved
const READ_ONLY_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
  'TodoWrite',
  'Agent',
  'EnterPlanMode',
  'ExitPlanMode',
  'AskUserQuestion',
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
}

const settings: PermissionSettings = {
  autoApproveEdits: false,
  bashWhitelist: ['ls', 'pwd', 'echo', 'git', 'node', 'pnpm', 'npm', 'npx', 'tsc'],
}

let permissionIdCounter = 0
const pendingPermissions = new Map<number, {
  resolve: (allowed: boolean) => void
}>()

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

export function createCanUseTool(
  getMainWindow: () => BrowserWindow | null,
): CanUseTool {
  return async (toolName, input, _options) => {
    // Auto-approve read-only tools
    if (READ_ONLY_TOOLS.has(toolName)) {
      return ALLOW
    }

    // Edit tools: gated by setting
    if (EDIT_TOOLS.has(toolName)) {
      if (settings.autoApproveEdits) {
        return ALLOW
      }
      return promptUser(getMainWindow, toolName, input as Record<string, unknown>)
    }

    // Bash: check read-only patterns, then whitelist, then prompt
    if (toolName === 'Bash') {
      const command = extractBashCommand(input as Record<string, unknown>)
      if (isBashReadOnly(command)) {
        return ALLOW
      }
      if (isBashWhitelisted(command)) {
        return ALLOW
      }
      return promptUser(getMainWindow, toolName, input as Record<string, unknown>)
    }

    // Unknown tools: prompt
    return promptUser(getMainWindow, toolName, input as Record<string, unknown>)
  }
}

async function promptUser(
  getMainWindow: () => BrowserWindow | null,
  toolName: string,
  input: Record<string, unknown>,
): Promise<PermissionResult> {
  const win = getMainWindow()
  if (!win) return DENY

  const id = ++permissionIdCounter
  win.webContents.send('agent:permission-request', { id, tool: toolName, input })

  return new Promise((resolve) => {
    pendingPermissions.set(id, {
      resolve: (allowed) => resolve(allowed ? ALLOW : DENY),
    })
  })
}

export function registerPermissionHandlers() {
  ipcMain.on('agent:permission-response', (_event, data: { id: number; allowed: boolean }) => {
    const pending = pendingPermissions.get(data.id)
    if (pending) {
      pending.resolve(data.allowed)
      pendingPermissions.delete(data.id)
    }
  })

  ipcMain.on('agent:settings-update', (_event, update: Partial<PermissionSettings>) => {
    if (update.autoApproveEdits !== undefined) {
      settings.autoApproveEdits = update.autoApproveEdits
    }
    if (update.bashWhitelist !== undefined) {
      settings.bashWhitelist = update.bashWhitelist
    }
  })
}
