import { useState, useCallback } from 'react'

export interface DraftSession {
  draftId: string
  createdAt: number
  cwd?: string
  pendingNewChat: boolean
  generatedTitle?: string
}

const STORAGE_KEY = 'draft-sessions'
const STALE_MS = 24 * 60 * 60 * 1000 // 24 hours

function readDrafts(): DraftSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Array<Partial<DraftSession> & { draftId: string; createdAt: number }>
    const normalized: DraftSession[] = parsed.map((d) => ({
      draftId: d.draftId,
      createdAt: d.createdAt,
      cwd: d.cwd,
      pendingNewChat: d.pendingNewChat ?? true,
      generatedTitle: d.generatedTitle,
    }))
    // Clean up stale drafts
    const now = Date.now()
    return normalized.filter(d => now - d.createdAt < STALE_MS)
  } catch {
    return []
  }
}

function writeDrafts(drafts: DraftSession[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts))
}

export function useDraftSessions() {
  const [drafts, setDrafts] = useState<DraftSession[]>(readDrafts)

  const createDraft = useCallback((cwd?: string): DraftSession => {
    const draft: DraftSession = {
      draftId: `draft-${Date.now()}`,
      createdAt: Date.now(),
      cwd,
      pendingNewChat: true,
    }
    setDrafts(prev => {
      const next = [draft, ...prev]
      writeDrafts(next)
      return next
    })
    return draft
  }, [])

  const removeDraft = useCallback((draftId: string) => {
    setDrafts(prev => {
      const next = prev.filter(d => d.draftId !== draftId)
      writeDrafts(next)
      return next
    })
  }, [])

  const updateDraftCwd = useCallback((draftId: string, cwd: string) => {
    setDrafts(prev => {
      const next = prev.map(d => d.draftId === draftId ? { ...d, cwd } : d)
      writeDrafts(next)
      return next
    })
  }, [])

  const setDraftGeneratedTitle = useCallback((draftId: string, title: string) => {
    const normalized = title.trim()
    if (!normalized) return
    setDrafts(prev => {
      const next = prev.map(d => d.draftId === draftId
        ? { ...d, generatedTitle: normalized, pendingNewChat: false }
        : d)
      writeDrafts(next)
      return next
    })
  }, [])

  const promoteDraft = useCallback((draftId: string, realSessionId?: string) => {
    if (realSessionId) {
      // Replace draft ID with real session ID — keeps the row visible in sidebar
      // until the real session appears from fetchSessions
      setDrafts(prev => {
        const next = prev.map(d => d.draftId === draftId ? { ...d, draftId: realSessionId } : d)
        writeDrafts(next)
        return next
      })
    } else {
      removeDraft(draftId)
    }
  }, [removeDraft])

  return { drafts, createDraft, removeDraft, updateDraftCwd, setDraftGeneratedTitle, promoteDraft }
}
