import type { SessionInfo } from '@codr-works/types'
import type { IndexedSessionMeta } from './session-index'
import type { AgentProviderId } from './provider'

export interface IndexedSessionMessages {
  provider: AgentProviderId
  rawMessages: unknown[]
}

export interface ClaudeDbSessionMeta {
  sessionId: string
  name: string | null
  firstPrompt: string | null
}

export interface SessionListInput {
  indexedSessions: IndexedSessionMeta[]
  claudeSessions: SessionInfo[]
  claudeDbSessions: ClaudeDbSessionMeta[]
}

export interface SessionInfoWithProvider extends SessionInfo {
  provider: AgentProviderId
  model?: string
  thinkingBudget?: string
}

interface ChooseTitleInput {
  dbTitle?: string | null
  indexedTitle?: string | null
  firstPrompt?: string | null
  fallbackSummary?: string | null
}

export function chooseTitle(input: ChooseTitleInput): string {
  const title = input.dbTitle
    || input.indexedTitle
    || input.firstPrompt
    || input.fallbackSummary
    || ''

  const normalized = title.trim()
  return normalized || 'Untitled Session'
}

export function shouldUseIndexedMessages(
  indexed: IndexedSessionMessages | null,
  expectedProvider: AgentProviderId,
): indexed is IndexedSessionMessages {
  return indexed?.provider === expectedProvider
}

export function resolveSessionProvider(
  selectedProvider: AgentProviderId,
  storedProvider?: AgentProviderId,
): AgentProviderId {
  return storedProvider || selectedProvider
}

export function buildSessionList(input: SessionListInput): {
  sessions: SessionInfoWithProvider[]
  titlesLoaded: boolean
} {
  const dbMap = new Map<string, ClaudeDbSessionMeta>()
  for (const session of input.claudeDbSessions) {
    dbMap.set(session.sessionId, session)
  }

  const sdkMap = new Map<string, SessionInfo>()
  for (const session of input.claudeSessions) {
    sdkMap.set(session.sessionId, session)
  }

  const merged: SessionInfoWithProvider[] = input.indexedSessions.map((indexed) => {
    const sdkSession = indexed.provider === 'claude' ? sdkMap.get(indexed.sessionId) : undefined
    const dbSession = indexed.provider === 'claude' ? dbMap.get(indexed.sessionId) : undefined
    const firstPrompt = dbSession?.firstPrompt || indexed.firstPrompt || sdkSession?.firstPrompt
    const generatedTitle = dbSession?.name || indexed.title || sdkSession?.generatedTitle

    return {
      sessionId: indexed.sessionId,
      summary: chooseTitle({
        dbTitle: dbSession?.name,
        indexedTitle: indexed.title,
        firstPrompt,
        fallbackSummary: sdkSession?.summary,
      }),
      lastModified: indexed.provider === 'claude'
        ? (sdkSession?.lastModified || indexed.updatedAt || indexed.createdAt)
        : (indexed.updatedAt || sdkSession?.lastModified || indexed.createdAt),
      fileSize: sdkSession?.fileSize || 0,
      customTitle: sdkSession?.customTitle,
      generatedTitle,
      firstPrompt: firstPrompt || undefined,
      gitBranch: sdkSession?.gitBranch,
      cwd: indexed.workspaceDir || sdkSession?.cwd,
      provider: indexed.provider,
      model: indexed.model,
      thinkingBudget: indexed.thinkingBudget,
    }
  })

  for (const sdkSession of input.claudeSessions) {
    if (merged.some((session) => session.sessionId === sdkSession.sessionId)) continue
    const dbSession = dbMap.get(sdkSession.sessionId)
    merged.push({
      ...sdkSession,
      summary: chooseTitle({
        dbTitle: dbSession?.name,
        indexedTitle: sdkSession.generatedTitle,
        firstPrompt: dbSession?.firstPrompt || sdkSession.firstPrompt,
        fallbackSummary: sdkSession.summary,
      }),
      generatedTitle: dbSession?.name || sdkSession.generatedTitle,
      firstPrompt: dbSession?.firstPrompt || sdkSession.firstPrompt,
      provider: 'claude',
    })
  }

  merged.sort((a, b) => b.lastModified - a.lastModified)
  return {
    sessions: merged,
    titlesLoaded: input.claudeDbSessions.length > 0 || merged.some((session) => !!session.generatedTitle),
  }
}
