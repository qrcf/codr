import { useState, useCallback } from 'react'

const ARCHIVED_KEY = 'archived-sessions'
const SHOW_KEY = 'show-archived'

function readArchivedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(ARCHIVED_KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw) as string[])
  } catch {
    return new Set()
  }
}

function writeArchivedIds(ids: Set<string>): void {
  localStorage.setItem(ARCHIVED_KEY, JSON.stringify([...ids]))
}

export function useArchivedSessions() {
  const [archivedIds, setArchivedIds] = useState<Set<string>>(readArchivedIds)
  const [showArchived, setShowArchived] = useState(() => {
    return localStorage.getItem(SHOW_KEY) === 'true'
  })

  const archiveSession = useCallback((id: string) => {
    setArchivedIds(prev => {
      const next = new Set(prev)
      next.add(id)
      writeArchivedIds(next)
      return next
    })
  }, [])

  const unarchiveSession = useCallback((id: string) => {
    setArchivedIds(prev => {
      const next = new Set(prev)
      next.delete(id)
      writeArchivedIds(next)
      return next
    })
  }, [])

  const isArchived = useCallback((id: string) => archivedIds.has(id), [archivedIds])

  const handleSetShowArchived = useCallback((show: boolean) => {
    setShowArchived(show)
    localStorage.setItem(SHOW_KEY, String(show))
  }, [])

  return {
    archivedIds,
    archiveSession,
    unarchiveSession,
    isArchived,
    showArchived,
    setShowArchived: handleSetShowArchived,
  }
}
