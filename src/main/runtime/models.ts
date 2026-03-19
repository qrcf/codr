import { query } from '@anthropic-ai/claude-agent-sdk'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AgentProviderId } from './provider'
import { getClaudeCliPath } from './providers/claude/provider'
import { getAcpProvider } from './acp/registry'
import type { SessionConfigSelectOption, SessionConfigSelectOptions, SessionConfigSelectGroup, SessionConfigOption } from '@agentclientprotocol/sdk'
import { updateCapability } from './provider-capabilities'

const execFileAsync = promisify(execFile)

export interface ModelOption {
  value: string
  displayName: string
  has1MContext?: boolean
}

// In-memory caches (per provider)
const modelCache = new Map<AgentProviderId, ModelOption[]>()

/**
 * Fetch available models for a provider. Results are cached in memory.
 * Pass `forceRefresh` to bypass the cache (e.g. after re-auth).
 */
export async function getModelsForProvider(
  provider: AgentProviderId,
  forceRefresh = false,
): Promise<ModelOption[]> {
  if (!forceRefresh && modelCache.has(provider)) {
    return modelCache.get(provider)!
  }

  const modelFetchers: Partial<Record<AgentProviderId, () => Promise<ModelOption[]>>> = {
    claude: fetchClaudeModels,
    cursor: () => fetchAcpModels('cursor'),
  }
  const fetcher = modelFetchers[provider]
  const models = fetcher ? await fetcher() : []

  if (models.length > 0) {
    modelCache.set(provider, models)
  }
  return models
}

/**
 * Pre-populate model cache from ACP configOptions.
 * Called by AcpProvider when it receives configOptions (newSession / session update).
 * Enables the renderer to refetch and display the correct models after cursor connects.
 */
export function updateModelCacheFromConfigOptions(
  providerId: AgentProviderId,
  options: SessionConfigOption[],
): void {
  const modelOpt = options.find(o => o.category === 'model' && o.type === 'select')
  if (!modelOpt || !('options' in modelOpt) || !(modelOpt as { options: unknown[] }).options.length) return
  const models = flattenSelectOptions((modelOpt as { options: SessionConfigSelectOptions }).options).map(o => ({
    value: o.value,
    displayName: o.name || o.value,
  }))
  if (models.length > 0) modelCache.set(providerId, models)
}

export function clearModelCache(provider?: AgentProviderId): void {
  if (provider) {
    modelCache.delete(provider)
  } else {
    modelCache.clear()
  }
}

// ---------------------------------------------------------------------------
// Display name cleanup for Claude models
// ---------------------------------------------------------------------------

/** Map SDK model family names to their current version numbers */
const FAMILY_VERSIONS: Record<string, string> = {
  opus: '4.6',
  sonnet: '4.6',
  haiku: '4.5',
}

function cleanClaudeModelName(value: string, displayName: string): string {
  // Strip "(1M context)" and similar parenthetical suffixes
  const name = displayName.replace(/\s*\(.*?\)\s*$/, '').trim()

  // If the display name already has a version number, keep it
  if (/\d/.test(name)) return name

  // SDK returns values like "opus[1m]", "sonnet", "haiku" — extract the family name
  const family = value.replace(/\[.*]$/, '').toLowerCase()
  const version = FAMILY_VERSIONS[family]
  if (version) return `${name} ${version}`

  return name
}

// ---------------------------------------------------------------------------
// Claude: probe query -> supportedModels()
// ---------------------------------------------------------------------------

async function fetchClaudeModels(): Promise<ModelOption[]> {
  let probeQuery: ReturnType<typeof query> | null = null
  try {
    const cliPath = getClaudeCliPath()
    probeQuery = query({
      // eslint-disable-next-line require-yield
      prompt: (async function* () {
        await new Promise(() => {}) // never resolves
      })(),
      options: {
        persistSession: false,
        ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
      },
    })

    const models = await Promise.race([
      probeQuery.supportedModels(),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('supportedModels timed out')), 10_000),
      ),
    ])

    if (!models || !Array.isArray(models)) return []

    return models
      .map((m) => {
        const value = (m as { value?: string }).value ?? ''
        const rawName = (m as { displayName?: string }).displayName ?? value
        const has1MContext = /1M context/i.test(rawName)
        return { value, displayName: rawName, has1MContext }
      })
      .filter((m) => m.value && !m.value.startsWith('default'))
      .map((m) => ({ ...m, displayName: cleanClaudeModelName(m.value, m.displayName) }))
  } catch (err) {
    console.error('[models] Failed to fetch Claude models:', err instanceof Error ? err.message : err)
    return []
  } finally {
    probeQuery?.close()
  }
}

// ---------------------------------------------------------------------------
// Generic ACP: configOptions (primary) + CLI fallback
// ---------------------------------------------------------------------------

async function fetchAcpModels(providerId: AgentProviderId): Promise<ModelOption[]> {
  // Primary: check ACP configOptions if provider is alive
  const provider = getAcpProvider(providerId)
  if (provider?.isAlive() && provider.lastConfigOptions) {
    const modelOpt = provider.lastConfigOptions.find(o => o.category === 'model')
    if (modelOpt && modelOpt.type === 'select' && modelOpt.options.length > 0) {
      updateCapability(providerId, 'model-selection', true)
      const flatOptions = flattenSelectOptions(modelOpt.options)
      return flatOptions.map(o => ({
        value: o.value,
        displayName: o.name || o.value,
      }))
    }
  }

  // Fallback: try provider's CLI model command if configured
  if (provider) {
    // Import the config to check for modelCommand
    const { createCursorConfig } = await import('./acp/configs/cursor')
    const config = providerId === 'cursor' ? createCursorConfig() : null
    if (config?.modelCommand) {
      try {
        const { stdout } = await execFileAsync(config.command, config.modelCommand.args, {
          env: { ...process.env, ...config.env },
          timeout: 10_000,
        })
        const models = config.modelCommand.parseOutput(stdout)
        if (models.length > 0) {
          updateCapability(providerId, 'model-selection', true)
        }
        return models
      } catch (err) {
        console.error(`[models] Failed to fetch ${providerId} models:`, err instanceof Error ? err.message : err)
      }
    }
  }

  return []
}

function flattenSelectOptions(options: SessionConfigSelectOptions): SessionConfigSelectOption[] {
  if (options.length === 0) return []
  if ('group' in options[0]) {
    return (options as SessionConfigSelectGroup[]).flatMap(g => g.options)
  }
  return options as SessionConfigSelectOption[]
}
