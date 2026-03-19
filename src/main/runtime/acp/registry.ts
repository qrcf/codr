import type { AgentProviderId } from '../../../shared/provider-types'
import type { AcpProvider } from './provider'

const providers = new Map<AgentProviderId, AcpProvider>()

export function getAcpProvider(id: AgentProviderId): AcpProvider | null {
  return providers.get(id) || null
}

export function registerAcpProvider(provider: AcpProvider): void {
  providers.set(provider.id, provider)
}

export function getAllAcpProviders(): AcpProvider[] {
  return [...providers.values()]
}
