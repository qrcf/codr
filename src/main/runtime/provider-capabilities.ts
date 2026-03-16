import type { AgentProviderId } from '../../shared/provider-types'

export type ProviderCapability =
  | 'model-selection'
  | 'reasoning-control'
  | 'token-usage'
  | 'attachments'
  | 'plan-review'
  | 'native-session-import'
  | 'title-generation'

interface ProviderCapabilityEntry {
  defaults: ReadonlySet<ProviderCapability>
  runtime: Set<ProviderCapability>
}

const ALL_CAPS: ProviderCapability[] = [
  'model-selection', 'reasoning-control', 'token-usage',
  'attachments', 'plan-review', 'native-session-import', 'title-generation',
]

const registry = new Map<AgentProviderId, ProviderCapabilityEntry>([
  ['claude', {
    defaults: new Set<ProviderCapability>(ALL_CAPS),
    runtime: new Set(),
  }],
  ['cursor', {
    defaults: new Set<ProviderCapability>([
      'attachments',
    ]),
    runtime: new Set(),
  }],
])

/** Broadcast callback — set by index.ts at startup to push capability changes to renderer */
let broadcastFn: ((providerId: AgentProviderId, capabilities: ProviderCapability[]) => void) | null = null

export function setBroadcastCapabilityChange(fn: (providerId: AgentProviderId, capabilities: ProviderCapability[]) => void): void {
  broadcastFn = fn
}

export function getCapabilities(id: AgentProviderId): Set<ProviderCapability> {
  const entry = registry.get(id)
  if (!entry) return new Set()
  return new Set([...entry.defaults, ...entry.runtime])
}

export function hasCapability(id: AgentProviderId, cap: ProviderCapability): boolean {
  return getCapabilities(id).has(cap)
}

export function updateCapability(id: AgentProviderId, cap: ProviderCapability, enabled: boolean): void {
  const entry = registry.get(id)
  if (!entry) return
  if (enabled) {
    entry.runtime.add(cap)
  } else {
    entry.runtime.delete(cap)
  }
  broadcastFn?.(id, [...getCapabilities(id)])
}

export function getAllCapabilities(): Record<AgentProviderId, ProviderCapability[]> {
  const result: Partial<Record<AgentProviderId, ProviderCapability[]>> = {}
  for (const [id, entry] of registry) {
    result[id] = [...new Set([...entry.defaults, ...entry.runtime])]
  }
  return result as Record<AgentProviderId, ProviderCapability[]>
}
