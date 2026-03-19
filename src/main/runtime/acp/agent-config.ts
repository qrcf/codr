import type { AgentProviderId } from '../../../shared/provider-types'
import type { ModelOption } from '../models'

export interface AcpAgentConfig {
  /** Provider ID used across the app */
  providerId: AgentProviderId

  /** Command to spawn the ACP subprocess */
  command: string
  /** Arguments to the command */
  args: string[]

  /** ACP authentication method ID (e.g., 'cursor_login') */
  authMethodId?: string

  /** Environment variables to merge with process.env for the subprocess */
  env?: Record<string, string>

  /** Log tag for console output (defaults to providerId) */
  logTag?: string

  /** Extension method handlers keyed by ACP method name.
   *  Return value is sent back to the agent. */
  extensionHandlers?: Record<string, AcpExtensionHandler>

  /** CLI command args for model listing (fallback when ACP configOptions unavailable).
   *  Runs: `config.command ...modelCommand.args` */
  modelCommand?: { args: string[]; parseOutput: (stdout: string) => ModelOption[] }
}

export type AcpExtensionHandler = (
  sessionId: string,
  params: Record<string, unknown>,
  context: AcpExtensionContext,
) => Promise<Record<string, unknown>>

export interface AcpExtensionContext {
  broadcaster: import('../../event-broadcaster').EventBroadcaster
  registerPendingPermission: typeof import('../../permissions').registerPendingPermission
  registerPendingQuestion: typeof import('../../permissions').registerPendingQuestion
  adapter: import('./stream-adapter').AcpStreamAdapter
  callbacks: import('../provider').ProviderRunCallbacks
}
