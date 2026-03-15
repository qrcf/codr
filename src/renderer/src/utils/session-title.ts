type SessionTitleInfo = Pick<SessionInfo, 'customTitle' | 'generatedTitle' | 'firstPrompt'>

function normalizeTitle(value?: string | null): string {
  return (value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function getCandidateTitle(session: SessionTitleInfo | null | undefined): string | null {
  return session?.customTitle || session?.generatedTitle || null
}

function isPromptDerivedTitle(session: SessionTitleInfo | null | undefined): boolean {
  const candidate = getCandidateTitle(session)
  if (!candidate) return false
  return normalizeTitle(candidate) !== '' && normalizeTitle(candidate) === normalizeTitle(session?.firstPrompt)
}

export function hasStableSessionTitle(session: SessionTitleInfo | null | undefined): boolean {
  const candidate = getCandidateTitle(session)
  if (!candidate || candidate === 'New Chat') return false
  return !isPromptDerivedTitle(session)
}

export function getHeaderSessionTitle(
  session: SessionTitleInfo | null | undefined,
  isPendingNewChat: boolean,
): string | null {
  if (isPendingNewChat) return 'New Chat'
  const candidate = getCandidateTitle(session)
  if (!candidate || isPromptDerivedTitle(session)) return null
  return candidate
}
