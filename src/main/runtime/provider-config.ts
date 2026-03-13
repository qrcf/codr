import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AgentProviderId } from './provider'

interface ProviderConfigFile {
  selectedProvider: AgentProviderId
}

const DEFAULT_PROVIDER: AgentProviderId = 'claude'

let cachedProvider: AgentProviderId | null = null

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'agent-runtime', 'provider-config.json')
}

async function ensureConfigDir() {
  await mkdir(path.dirname(getConfigPath()), { recursive: true })
}

export async function getSelectedProvider(): Promise<AgentProviderId> {
  if (cachedProvider) return cachedProvider
  try {
    const raw = await readFile(getConfigPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<ProviderConfigFile>
    if (parsed.selectedProvider === 'claude' || parsed.selectedProvider === 'codex') {
      cachedProvider = parsed.selectedProvider
      return cachedProvider
    }
  } catch {
    // fall back to default when config is missing/corrupt
  }
  cachedProvider = DEFAULT_PROVIDER
  return cachedProvider
}

export async function setSelectedProvider(provider: AgentProviderId): Promise<AgentProviderId> {
  cachedProvider = provider
  await ensureConfigDir()
  const payload: ProviderConfigFile = { selectedProvider: provider }
  await writeFile(getConfigPath(), JSON.stringify(payload, null, 2), 'utf-8')
  return provider
}
