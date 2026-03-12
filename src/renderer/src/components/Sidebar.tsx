import { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, ChevronUp, ChevronDown, X, Settings, Archive, ArchiveRestore } from 'lucide-react'
import { timeAgo } from '../utils/timeAgo'
import { parseSessionMessages, extractTokenUsageFromRaw } from '../utils/sessionParser'
import { RemotePanel } from './RemotePanel'
import type { ChatMessage } from '../types'
import type { DraftSession } from '../hooks/useDraftSessions'
import './Sidebar.css'

export type SessionStatusType = 'question' | 'plan-review' | 'permission'

interface SidebarProps {
  isOpen: boolean
  activeSessionId: string | null
  onLoadSession: (sessionId: string, messages: ChatMessage[], initialTokenUsage?: TokenUsage | null) => void
  onNewChat: () => void
  onActiveSessionInfo?: (session: SessionInfo | null) => void
  onOpenSettings?: () => void
  onOpenManageProject?: () => void
  backgroundQuerySessionIds?: Set<string>
  sessionStatuses?: Map<string, SessionStatusType>
  onFolderChange?: (folder: string | null) => void
  onCloseSidebar?: () => void
  drafts?: DraftSession[]
  archivedIds?: Set<string>
  showArchived?: boolean
  onToggleShowArchived?: () => void
  onArchiveSession?: (id: string) => void
  onUnarchiveSession?: (id: string) => void
}

function folderName(path: string): string {
  return path.split('/').pop() || path
}

export function Sidebar({
  isOpen,
  activeSessionId,
  onLoadSession,
  onNewChat,
  onActiveSessionInfo,
  onOpenSettings,
  onOpenManageProject,
  backgroundQuerySessionIds,
  sessionStatuses,
  onFolderChange,
  onCloseSidebar,
  drafts,
  archivedIds,
  showArchived,
  onToggleShowArchived,
  onArchiveSession,
  onUnarchiveSession,
}: SidebarProps) {
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null)
  const [accountError, setAccountError] = useState<string | null>(null)
  const [loadingSession, setLoadingSession] = useState<string | null>(null)
  const [selectedFolder, setSelectedFolder] = useState<string | null>(() => {
    return localStorage.getItem('selected-folder') || null
  })
  const [projects, setProjects] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('projects') || '[]') }
    catch { return [] }
  })
  const [showRecents, setShowRecents] = useState(false)
  const [visibleCount, setVisibleCount] = useState(30)
  const [titlesLoaded, setTitlesLoaded] = useState(false)

  const addProject = useCallback((folder: string) => {
    setProjects(prev => {
      if (prev.includes(folder)) return prev
      const next = [folder, ...prev]
      localStorage.setItem('projects', JSON.stringify(next))
      return next
    })
  }, [])
  const [repoNames, setRepoNames] = useState<Record<string, string>>({})
  const recentsRef = useRef<HTMLDivElement>(null)

  // Resolve repo names (@org/name) for all known folders
  useEffect(() => {
    const folderSet = new Set(projects)
    if (selectedFolder) folderSet.add(selectedFolder)
    for (const s of sessions) { if (s.cwd) folderSet.add(s.cwd) }
    const unresolvedFolders = [...folderSet].filter(f => !(f in repoNames))
    if (unresolvedFolders.length === 0) return
    let cancelled = false
    Promise.all(
      unresolvedFolders.map(async (folder) => {
        try {
          const name = await window.claude.getRepoName?.(folder)
          return [folder, name] as const
        } catch {
          return [folder, undefined] as const
        }
      })
    ).then((results) => {
      if (cancelled) return
      const newEntries: Record<string, string> = {}
      for (const [folder, name] of results) {
        if (name) newEntries[folder] = name
      }
      if (Object.keys(newEntries).length > 0) {
        setRepoNames(prev => ({ ...prev, ...newEntries }))
      }
    })
    return () => { cancelled = true }
  }, [projects, selectedFolder, sessions])

  function displayName(path: string): string {
    return repoNames[path] || folderName(path)
  }

  const fetchSessions = useCallback(async () => {
    try {
      const result = await window.claude.listSessions()
      const list = result.sessions as SessionInfo[]
      if (result.titlesLoaded) setTitlesLoaded(true)
      setSessions(prev => {
        // Preserve previously known DB-enriched fields across refreshes
        const prevMap = new Map<string, SessionInfo>()
        for (const s of prev) prevMap.set(s.sessionId, s)
        return list.map(s => {
          const old = prevMap.get(s.sessionId)
          return {
            ...s,
            generatedTitle: s.generatedTitle || old?.generatedTitle,
            firstPrompt: s.firstPrompt || old?.firstPrompt,
            customTitle: s.customTitle || old?.customTitle,
          }
        })
      })
      setSessionsLoaded(true)

      // Backfill title for first untitled session — refresh-hint will trigger next one
      const untitled = list.filter(s => !s.generatedTitle && !s.customTitle)
      if (untitled.length > 0 && window.claude.ensureTitle) {
        window.claude.ensureTitle(untitled[0].sessionId, untitled[0].firstPrompt || untitled[0].summary).catch(() => {})
      }
    } catch {
      setSessionsLoaded(true)
      // Silently handle — sessions may not be available
    }
  }, [])

  useEffect(() => {
    fetchSessions()

    const unsub = window.claude.onSessionRefreshHint(() => {
      fetchSessions()
    })

    return unsub
  }, [fetchSessions])

  // Fetch account info with retry — probe query may fail in packaged builds
  useEffect(() => {
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false
    let attempts = 0
    const MAX_ATTEMPTS = 6

    const fetchAccountInfo = () => {
      window.claude.getAccountInfo().then((result) => {
        if (cancelled) return
        // Check for error response from main process
        if (result && typeof result === 'object' && 'error' in result) {
          const errMsg = (result as { error: string }).error
          console.error('[account-info]', errMsg)
          setAccountError(errMsg)
          if (attempts < MAX_ATTEMPTS) {
            attempts++
            retryTimer = setTimeout(fetchAccountInfo, 5000)
          }
          return
        }
        if (result) {
          setAccountInfo(result)
          setAccountError(null)
        } else if (attempts < MAX_ATTEMPTS) {
          attempts++
          retryTimer = setTimeout(fetchAccountInfo, 5000)
        }
      }).catch((err) => {
        if (cancelled) return
        console.error('[account-info] IPC error:', err)
        if (attempts < MAX_ATTEMPTS) {
          attempts++
          retryTimer = setTimeout(fetchAccountInfo, 5000)
        }
      })
    }

    fetchAccountInfo()

    // Also listen for account info pushed from main process (fallback from real queries)
    const unsubAccountInfo = window.claude.onAccountInfoUpdate?.((info: AccountInfo) => {
      if (info) setAccountInfo(info)
    })

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      unsubAccountInfo?.()
    }
  }, [])

  // Push active session info up to parent
  useEffect(() => {
    if (!onActiveSessionInfo) return
    if (!activeSessionId) { onActiveSessionInfo(null); return }
    // Check real sessions first, then drafts
    const match = sessions.find(s => s.sessionId === activeSessionId)
    if (match) { onActiveSessionInfo(match); return }
    const draftMatch = drafts?.find(d => d.draftId === activeSessionId)
    if (draftMatch) {
      onActiveSessionInfo({
        sessionId: draftMatch.draftId,
        summary: '',
        lastModified: draftMatch.createdAt,
        fileSize: 0,
        customTitle: 'New Chat',
        cwd: draftMatch.cwd,
      } as SessionInfo)
      return
    }
    onActiveSessionInfo(null)
  }, [sessions, drafts, activeSessionId, onActiveSessionInfo])

  // External session polling replaced by main process watcher (sessions:refresh-hint)

  // Close recents dropdown on outside click
  useEffect(() => {
    if (!showRecents) return
    const handler = (e: MouseEvent) => {
      if (recentsRef.current && !recentsRef.current.contains(e.target as Node)) {
        setShowRecents(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showRecents])

  // Auto-populate projects list from session cwds
  useEffect(() => {
    const cwds = new Set(sessions.map(s => s.cwd).filter(Boolean) as string[])
    setProjects(prev => {
      const existing = new Set(prev)
      const newFolders = [...cwds].filter(f => !existing.has(f))
      if (newFolders.length === 0) return prev
      const next = [...prev, ...newFolders]
      localStorage.setItem('projects', JSON.stringify(next))
      return next
    })
  }, [sessions])

  // Convert drafts to SessionInfo shape and prepend
  const draftAsSessionInfo: SessionInfo[] = (drafts || [])
    .filter(d => !selectedFolder || d.cwd === selectedFolder || d.cwd?.startsWith(selectedFolder + '/'))
    .map(d => ({
      sessionId: d.draftId,
      summary: '',
      lastModified: d.createdAt,
      fileSize: 0,
      customTitle: 'New Chat',
      cwd: d.cwd,
    } as SessionInfo))

  const realFiltered = selectedFolder
    ? sessions.filter(s => s.cwd === selectedFolder || s.cwd?.startsWith(selectedFolder + '/'))
    : sessions

  const allWithDrafts = [...draftAsSessionInfo, ...realFiltered]

  // Apply archive filtering
  const visibleSessions = showArchived
    ? allWithDrafts
    : allWithDrafts.filter(s => !archivedIds?.has(s.sessionId))

  const filteredSessions = visibleSessions.slice(0, visibleCount)
  const hasMore = visibleSessions.length > visibleCount

  const handleSessionClick = async (sessionId: string) => {
    if (loadingSession) return
    if (sessionId === activeSessionId) return

    // Draft sessions have no messages on disk
    if (sessionId.startsWith('draft-')) {
      onLoadSession(sessionId, [])
      if (window.innerWidth <= 768) onCloseSidebar?.()
      return
    }

    setLoadingSession(sessionId)
    try {
      const raw = await window.claude.getSessionMessages(sessionId)
      const parsed = parseSessionMessages(raw)
      onLoadSession(sessionId, parsed, extractTokenUsageFromRaw(raw))

      const session = sessions.find(s => s.sessionId === sessionId)

      // Set selected project to match the chat's project
      if (session?.cwd) {
        setSelectedFolder(session.cwd)
        localStorage.setItem('selected-folder', session.cwd)
        onFolderChange?.(session.cwd)
        addProject(session.cwd)
      }

      // Backfill title for sessions that don't have one yet
      if (session && !session.generatedTitle && window.claude.ensureTitle) {
        window.claude.ensureTitle(sessionId).catch(() => {})
      }

      // Auto-close sidebar on mobile
      if (window.innerWidth <= 768) onCloseSidebar?.()
    } catch {
      // Failed to load session
    } finally {
      setLoadingSession(null)
    }
  }

  const handleBrowseFolder = async () => {
    const folder = await window.claude.selectFolder()
    if (!folder) return
    setSelectedFolder(folder)
    localStorage.setItem('selected-folder', folder)
    onFolderChange?.(folder)
    addProject(folder)
    setShowRecents(false)
  }

  const handleClearFolder = () => {
    setSelectedFolder(null)
    localStorage.removeItem('selected-folder')
    onFolderChange?.(null)
    setShowRecents(false)
  }

  const handlePickRecent = (folder: string) => {
    setSelectedFolder(folder)
    localStorage.setItem('selected-folder', folder)
    onFolderChange?.(folder)
    setShowRecents(false)
  }

  return (
    <div className={`sidebar ${isOpen ? '' : 'collapsed'}`}>
      <div className="sidebar-header">
        <button className="btn-new-chat" onClick={() => { onNewChat(); if (window.innerWidth <= 768) onCloseSidebar?.() }}>
          + New Chat
        </button>
        <button className="btn-refresh-sessions" onClick={fetchSessions} title="Refresh sessions">
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="folder-selector" ref={recentsRef}>
        <div className="folder-row">
          <div
            className="folder-current"
            onClick={() => setShowRecents(prev => !prev)}
          >
            <span className="folder-label">
              {selectedFolder ? displayName(selectedFolder) : 'All Projects'}
            </span>
            <span className="folder-chevron">{showRecents ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
          </div>
          {selectedFolder && (
            <button className="folder-clear" onClick={handleClearFolder} title="Show all projects">
              <X size={14} />
            </button>
          )}
        </div>
        {showRecents && (
          <div className="folder-dropdown">
            {selectedFolder && (
              <div className="folder-dropdown-item" onClick={handleClearFolder}>
                All Projects
              </div>
            )}
            {projects
              .filter(f => f !== selectedFolder)
              .map(folder => (
                <div
                  key={folder}
                  className="folder-dropdown-item"
                  onClick={() => handlePickRecent(folder)}
                >
                  <span className="folder-item-name">{displayName(folder)}</span>
                  <span className="folder-item-path">{folder}</span>
                </div>
              ))}
            <div className="folder-dropdown-item folder-browse" onClick={handleBrowseFolder}>
              Browse...
            </div>
          </div>
        )}
        {selectedFolder && (
          <button className="btn-manage-project" onClick={onOpenManageProject}>
            Manage Project
          </button>
        )}
      </div>

      <div className="archive-toggle-row">
        <button
          className={`btn-archive-toggle ${showArchived ? 'active' : ''}`}
          onClick={onToggleShowArchived}
          title={showArchived ? 'Hide archived chats' : 'Show archived chats'}
        >
          <Archive size={13} />
          <span>{showArchived ? 'Showing archived' : 'Show archived'}</span>
        </button>
      </div>

      <div className="sidebar-sessions">
        {!sessionsLoaded ? (
          <div className="sidebar-empty">Loading sessions...</div>
        ) : filteredSessions.length === 0 ? (
          <div className="sidebar-empty">
            {selectedFolder ? 'No sessions in this project' : 'No previous chats'}
          </div>
        ) : (
          <>
            {filteredSessions.map((session) => {
              const isDraft = session.sessionId.startsWith('draft-')
              const isSessionArchived = archivedIds?.has(session.sessionId)
              return (
                <div
                  key={session.sessionId}
                  className={`session-item ${session.sessionId === activeSessionId ? 'active' : ''} ${loadingSession === session.sessionId ? 'loading' : ''} ${isDraft ? 'session-item--draft' : ''} ${isSessionArchived ? 'session-item--archived' : ''}`}
                  onClick={() => handleSessionClick(session.sessionId)}
                >
                  <div className="session-summary">
                    {backgroundQuerySessionIds?.has(session.sessionId) && session.sessionId !== activeSessionId && (
                      <span className="background-query-indicator" title="Query running in background" />
                    )}
                    {sessionStatuses?.has(session.sessionId) && session.sessionId !== activeSessionId && (() => {
                      const status = sessionStatuses.get(session.sessionId)!
                      const label = status === 'question' ? 'Question' : status === 'plan-review' ? 'Plan' : 'Permission'
                      const title = status === 'question' ? 'Waiting for answer' : status === 'plan-review' ? 'Review plan' : 'Needs approval'
                      return <span className={`session-status-pill session-status-${status}`} title={title}>{label}</span>
                    })()}
                    {session.customTitle || session.generatedTitle || (isDraft ? 'New Chat' : (!titlesLoaded && <span className="session-title-loading" />))}
                  </div>
                  <div className="session-meta">
                    <span>{timeAgo(session.lastModified)}</span>
                    {session.cwd && !selectedFolder && (
                      <span className="project-name">{displayName(session.cwd)}</span>
                    )}
                    {session.gitBranch && (
                      <span className="git-branch-badge">{session.gitBranch}</span>
                    )}
                  </div>
                  <button
                    className="btn-archive-session"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (isSessionArchived) {
                        onUnarchiveSession?.(session.sessionId)
                      } else {
                        onArchiveSession?.(session.sessionId)
                      }
                    }}
                    title={isSessionArchived ? 'Unarchive' : 'Archive'}
                  >
                    {isSessionArchived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                  </button>
                </div>
              )
            })}
            {hasMore && (
              <button className="btn-load-more" onClick={() => setVisibleCount(v => v + 30)}>
                Load More
              </button>
            )}
          </>
        )}
      </div>

      <div className="sidebar-footer">
        <RemotePanel />

        <div className="auth-row">
          <div className="auth-info">
            {accountInfo ? (
              <>
                {accountInfo.email && <div className="auth-email">{accountInfo.email}</div>}
                <div className="auth-badges">
                  {accountInfo.subscriptionType && (
                    <span className="auth-badge">{accountInfo.subscriptionType}</span>
                  )}
                  {accountInfo.apiKeySource && (
                    <span className="auth-badge">{accountInfo.apiKeySource}</span>
                  )}
                </div>
              </>
            ) : (
              <div className="auth-status-unknown" title={accountError || undefined}>
                {accountError ? 'Auth failed' : 'Checking auth...'}
              </div>
            )}
          </div>
          <button className="btn-settings-gear" onClick={onOpenSettings} title="Settings"><Settings size={14} /></button>
        </div>

      </div>
    </div>
  )
}
