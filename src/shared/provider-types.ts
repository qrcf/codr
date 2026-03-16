export const PROVIDER_IDS = ['claude', 'cursor'] as const

export type AgentProviderId = (typeof PROVIDER_IDS)[number]

export function isValidProviderId(value: string): value is AgentProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value)
}
