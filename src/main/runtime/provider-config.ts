import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'
import type { AgentProviderId } from './provider'

interface ProviderConfigFile {
  selectedProvider: AgentProviderId
  selectedModels?: Partial<Record<AgentProviderId, string>>
}

const DEFAULT_PROVIDER: AgentProviderId = 'claude'

let cachedProvider: AgentProviderId | null = null
let cachedModels: Partial<Record<AgentProviderId, string>> | null = null

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'agent-runtime', 'provider-config.json')
}

async function ensureConfigDir() {
  await mkdir(path.dirname(getConfigPath()), { recursive: true })
}

async function loadConfig(): Promise<Partial<ProviderConfigFile>> {
  try {
    const raw = await readFile(getConfigPath(), 'utf-8')
    return JSON.parse(raw) as Partial<ProviderConfigFile>
  } catch {
    return {}
  }
}

async function saveConfig(cfg: ProviderConfigFile): Promise<void> {
  await ensureConfigDir()
  await writeFile(getConfigPath(), JSON.stringify(cfg, null, 2), 'utf-8')
}

export async function getSelectedProvider(): Promise<AgentProviderId> {
  if (cachedProvider) return cachedProvider
  const parsed = await loadConfig()
  if (parsed.selectedProvider === 'claude' || parsed.selectedProvider === 'codex') {
    cachedProvider = parsed.selectedProvider
  } else {
    cachedProvider = DEFAULT_PROVIDER
  }
  if (parsed.selectedModels && !cachedModels) {
    cachedModels = parsed.selectedModels
  }
  return cachedProvider
}

export async function setSelectedProvider(provider: AgentProviderId): Promise<AgentProviderId> {
  cachedProvider = provider
  await saveConfig({
    selectedProvider: provider,
    ...(cachedModels ? { selectedModels: cachedModels } : {}),
  })
  return provider
}

export async function getSelectedModel(provider: AgentProviderId): Promise<string | undefined> {
  if (cachedModels) return cachedModels[provider]
  const parsed = await loadConfig()
  cachedModels = parsed.selectedModels ?? {}
  return cachedModels[provider]
}

export function getClaudeSettingsDefaults(): { effortLevel?: string } {
  try {
    const raw = readFileSync(path.join(homedir(), '.claude', 'settings.json'), 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const effortLevel = parsed.effortLevel as string | undefined
    return effortLevel ? { effortLevel } : {}
  } catch {
    return {}
  }
}

export async function setSelectedModel(provider: AgentProviderId, model: string | undefined): Promise<void> {
  if (!cachedModels) {
    const parsed = await loadConfig()
    cachedModels = parsed.selectedModels ?? {}
  }
  if (model) {
    cachedModels[provider] = model
  } else {
    delete cachedModels[provider]
  }
  const currentProvider = cachedProvider ?? DEFAULT_PROVIDER
  await saveConfig({
    selectedProvider: currentProvider,
    selectedModels: cachedModels,
  })
}
