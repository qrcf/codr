import { query } from '@anthropic-ai/claude-agent-sdk'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { AgentProviderId } from './provider'
import { getClaudeCliPath } from './providers/claude-provider'

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

  const models =
    provider === 'claude' ? await fetchClaudeModels() : await fetchCodexModels()

  if (models.length > 0) {
    modelCache.set(provider, models)
  }
  return models
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
  const family = value.replace(/\[.*\]$/, '').toLowerCase()
  const version = FAMILY_VERSIONS[family]
  if (version) return `${name} ${version}`

  return name
}

// ---------------------------------------------------------------------------
// Claude: probe query → supportedModels()
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
// Codex: read auth credentials, call OpenAI /v1/models
// ---------------------------------------------------------------------------

async function fetchCodexModels(): Promise<ModelOption[]> {
  const cachePath = join(homedir(), '.codex', 'models_cache.json')
  if (!existsSync(cachePath)) {
    console.warn('[models] No ~/.codex/models_cache.json found')
    return []
  }

  try {
    const data = JSON.parse(readFileSync(cachePath, 'utf-8')) as {
      models?: Array<{ slug: string; display_name?: string; visibility?: string; priority?: number }>
    }
    if (!data.models) return []

    return data.models
      .filter((m) => m.visibility === 'list')
      .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
      .map((m) => ({ value: m.slug, displayName: m.display_name || m.slug }))
  } catch (err) {
    console.error('[models] Failed to read Codex models cache:', err instanceof Error ? err.message : err)
    return []
  }
}
