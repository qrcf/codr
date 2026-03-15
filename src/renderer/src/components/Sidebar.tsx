import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { RefreshCw, ChevronRight, ChevronDown, X, Settings, Archive, ArchiveRestore, Sparkles, Terminal, Search, MoreVertical, Plus, FolderOpen, EyeOff, GitBranch } from 'lucide-react'
import { timeAgo } from '../utils/timeAgo'
import { parseSessionMessages, extractTokenUsageFromRaw, extractModelFromRaw } from '../utils/sessionParser'
import { SidebarProfile } from './SidebarProfile'
import type { ChatMessage } from '../types'
import type { DraftSession } from '../hooks/useDraftSessions'

export type SessionStatusType = 'question' | 'plan-review' | 'permission'

export interface ProjectInfo {
  path: string
  displayName: string
}

interface SidebarProps {
  isOpen: boolean
  activeSessionId: string | null
  onLoadSession: (sessionId: string, messages: ChatMessage[], initialTokenUsage?: TokenUsage | null, model?: string | null) => void
  onNewChat: (provider?: 'claude' | 'codex', cwd?: string) => void
  onActiveSessionInfo?: (session: SessionInfo | null) => void
  onOpenSettings?: () => void
  onOpenManageProject?: (folderPath: string) => void
  backgroundQuerySessionIds?: Set<string>
  sessionStatuses?: Map<string, SessionStatusType>
  onCloseSidebar?: () => void
  drafts?: DraftSession[]
  archivedIds?: Set<string>
  showArchived?: boolean
  onToggleShowArchived?: () => void
  onArchiveSession?: (id: string) => void
  onUnarchiveSession?: (id: string) => void
  userProfile?: { email: string | null; fullName: string | null; imageUrl: string | null } | null
  onProjectsUpdate?: (projects: ProjectInfo[]) => void
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
  onCloseSidebar,
  drafts,
  archivedIds,
  showArchived,
  onToggleShowArchived,
  onArchiveSession,
  onUnarchiveSession,
  userProfile,
  onProjectsUpdate,
}: SidebarProps) {
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null)
  const [accountError, setAccountError] = useState<string | null>(null)
  const [loadingSession, setLoadingSession] = useState<string | null>(null)
  const [projects, setProjects] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('projects') || '[]') }
    catch { return [] }
  })
  const [providerDropdownOpen, setProviderDropdownOpen] = useState(false)
  const providerDropdownRef = useRef<HTMLDivElement>(null)
  const [codexAvailable, setCodexAvailable] = useState<boolean | null>(null)

  // New project-first state
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [contextMenuProject, setContextMenuProject] = useState<string | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const [hiddenProjects, setHiddenProjects] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('hidden-projects') || '[]')) }
    catch { return new Set() }
  })

  const hideProject = useCallback((folder: string) => {
    setHiddenProjects(prev => {
      const next = new Set(prev)
      next.add(folder)
      localStorage.setItem('hidden-projects', JSON.stringify([...next]))
      return next
    })
  }, [])

  const addProject = useCallback((folder: string) => {
    setProjects(prev => {
      if (prev.includes(folder)) return prev
      const next = [folder, ...prev]
      localStorage.setItem('projects', JSON.stringify(next))
      return next
    })
    // Unhide if it was hidden
    setHiddenProjects(prev => {
      if (!prev.has(folder)) return prev
      const next = new Set(prev)
      next.delete(folder)
      localStorage.setItem('hidden-projects', JSON.stringify([...next]))
      return next
    })
  }, [])
  const [repoNames, setRepoNames] = useState<Record<string, string>>({})

  // Resolve repo names (@org/name) for all known folders
  useEffect(() => {
    const folderSet = new Set(projects)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- effect populates repoNames from projects/sessions
  }, [projects, sessions])

  const displayName = useCallback((path: string): string => {
    return repoNames[path] || folderName(path)
  }, [repoNames])

  // Push project list up to parent for ChatHeader dropdown
  useEffect(() => {
    if (!onProjectsUpdate) return
    const visibleProjects = projects.filter(p => !hiddenProjects.has(p))
    onProjectsUpdate(visibleProjects.map(p => ({ path: p, displayName: displayName(p) })))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- displayName is derived from repoNames (in deps)
  }, [projects, repoNames, hiddenProjects, onProjectsUpdate])

  const fetchSessions = useCallback(async () => {
    try {
      const result = await window.claude.listSessions()
      const list = result.sessions as SessionInfo[]
      setSessions(prev => {
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
    } catch {
      setSessionsLoaded(true)
    }
  }, [])

  useEffect(() => {
    fetchSessions()
    return window.claude.onSessionRefreshHint(() => {
      fetchSessions()
    })
  }, [fetchSessions])

  // Check codex availability once on mount
  useEffect(() => {
    window.claude.getProviderStatus?.().then(s => setCodexAvailable(s.codex.installed)).catch(() => setCodexAvailable(false))
  }, [])

  // Fetch account info with retry
  useEffect(() => {
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false
    let attempts = 0
    const MAX_ATTEMPTS = 6

    const fetchAccountInfo = () => {
      window.claude.getAccountInfo().then((result) => {
        if (cancelled) return
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
    // Session may be in transition (draft → real ID) — don't null out,
    // preserve previous activeSession until the session list refreshes.
  }, [sessions, drafts, activeSessionId, onActiveSessionInfo])

  // Close provider dropdown on outside click
  useEffect(() => {
    if (!providerDropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (providerDropdownRef.current && !providerDropdownRef.current.contains(e.target as Node)) {
        setProviderDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [providerDropdownOpen])

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenuProject) return
    const handler = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenuProject(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [contextMenuProject])

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

  // Auto-expand active session's project
  useEffect(() => {
    if (!activeSessionId) return
    const activeSessionMatch = sessions.find(s => s.sessionId === activeSessionId)
    const activeDraftMatch = drafts?.find(d => d.draftId === activeSessionId)
    const activeCwd = activeSessionMatch?.cwd || activeDraftMatch?.cwd
    if (activeCwd) {
      setExpandedProjects(prev => {
        if (prev.has(activeCwd)) return prev
        const next = new Set(prev)
        next.add(activeCwd)
        return next
      })
    }
  }, [activeSessionId, sessions, drafts])

  // Convert drafts to SessionInfo shape
  const draftAsSessionInfo: SessionInfo[] = (drafts || []).map(d => ({
    sessionId: d.draftId,
    summary: '',
    lastModified: d.createdAt,
    fileSize: 0,
    customTitle: 'New Chat',
    cwd: d.cwd,
  } as SessionInfo))

  const allSessions = [...draftAsSessionInfo, ...sessions]

  const activeSessionProvider = sessions.find(s => s.sessionId === activeSessionId)?.provider || 'claude'
  const defaultProvider: 'claude' | 'codex' = (codexAvailable && activeSessionProvider === 'codex') ? 'codex' : 'claude'

  // Apply archive filtering
  const visibleSessions = showArchived
    ? allSessions
    : allSessions.filter(s => !archivedIds?.has(s.sessionId))

  // Build project groups
  const projectGroups = useMemo(() => {
    const groups = new Map<string, SessionInfo[]>()
    const ungrouped: SessionInfo[] = []

    // Initialize groups for all known non-hidden projects
    for (const p of projects) {
      if (!hiddenProjects.has(p)) groups.set(p, [])
    }

    // Bucket sessions (skip sessions belonging to hidden projects)
    for (const s of visibleSessions) {
      if (s.cwd) {
        if (hiddenProjects.has(s.cwd)) continue
        if (!groups.has(s.cwd)) groups.set(s.cwd, [])
        groups.get(s.cwd)!.push(s)
      } else {
        ungrouped.push(s)
      }
    }

    // Sort sessions within each group by lastModified desc
    for (const [, group] of groups) {
      group.sort((a, b) => b.lastModified - a.lastModified)
    }
    ungrouped.sort((a, b) => b.lastModified - a.lastModified)

    // Filter by search query
    const query = searchQuery.toLowerCase().trim()
    let filteredEntries = [...groups.entries()]
    let filteredUngrouped = ungrouped

    if (query) {
      filteredEntries = filteredEntries.filter(([cwd, group]) => {
        const nameMatch = displayName(cwd).toLowerCase().includes(query)
        const sessionMatch = group.some(s =>
          (s.customTitle || s.generatedTitle || s.summary || '').toLowerCase().includes(query)
        )
        return nameMatch || sessionMatch
      })
      filteredUngrouped = ungrouped.filter(s =>
        (s.customTitle || s.generatedTitle || s.summary || '').toLowerCase().includes(query)
      )
    }

    // Sort projects by most recent session timestamp
    filteredEntries.sort((a, b) => {
      const aLatest = a[1].length > 0 ? a[1][0].lastModified : 0
      const bLatest = b[1].length > 0 ? b[1][0].lastModified : 0
      return bLatest - aLatest
    })

    return { entries: filteredEntries, ungrouped: filteredUngrouped }
  }, [projects, visibleSessions, searchQuery, hiddenProjects, displayName])

  const handleSessionClick = async (sessionId: string) => {
    if (loadingSession) return
    if (sessionId === activeSessionId) return

    if (sessionId.startsWith('draft-')) {
      onLoadSession(sessionId, [])
      if (window.innerWidth <= 768) onCloseSidebar?.()
      return
    }

    setLoadingSession(sessionId)
    try {
      const raw = await window.claude.getSessionMessages(sessionId)
      const parsed = parseSessionMessages(raw)
      onLoadSession(sessionId, parsed, extractTokenUsageFromRaw(raw), extractModelFromRaw(raw))

      const session = sessions.find(s => s.sessionId === sessionId)
      if (session?.cwd) addProject(session.cwd)

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
    addProject(folder)
    setExpandedProjects(prev => {
      const next = new Set(prev)
      next.add(folder)
      return next
    })
  }

  const toggleProject = (cwd: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev)
      if (next.has(cwd)) {
        next.delete(cwd)
      } else {
        next.add(cwd)
      }
      return next
    })
  }

  const statusPillClass = (status: SessionStatusType) => {
    const base = 'inline-flex items-center px-1.5 py-px rounded-[3px] text-[0.7em] font-medium tracking-[0.02em] shrink-0 animate-[status-glow_2s_ease-in-out_infinite]'
    if (status === 'question') return `${base} bg-[rgba(56,189,248,0.12)] text-[#38bdf8]`
    if (status === 'plan-review') return `${base} bg-[rgba(168,85,247,0.12)] text-[#a855f7]`
    return `${base} bg-[rgba(232,160,62,0.12)] text-[#e8a03e]`
  }

  const renderSessionRow = (session: SessionInfo) => {
    const isDraft = session.sessionId.startsWith('draft-')
    const isSessionArchived = archivedIds?.has(session.sessionId)
    const isActive = session.sessionId === activeSessionId
    const isLoading = loadingSession === session.sessionId

    return (
      <div
        key={session.sessionId}
        className={[
          'pl-7 pr-3 py-2 cursor-pointer border-l-[3px] transition-colors duration-100 relative group',
          'max-[768px]:pl-8 max-[768px]:pr-4 max-[768px]:py-3',
          isActive ? 'bg-bg-card border-l-accent' : 'border-l-transparent hover:bg-bg-card',
          isLoading ? 'opacity-60' : '',
          isSessionArchived ? 'opacity-50 hover:opacity-70' : '',
        ].filter(Boolean).join(' ')}
        onClick={() => handleSessionClick(session.sessionId)}
      >
        <div className={`text-[0.82em] whitespace-nowrap overflow-hidden text-ellipsis text-[#ddd] leading-[1.3] flex items-center gap-1.5 max-[768px]:text-[0.88em] ${isDraft ? 'italic text-text-muted' : ''}`}>
          {backgroundQuerySessionIds?.has(session.sessionId) && session.sessionId !== activeSessionId && (
            <span
              className="inline-block w-2 h-2 min-w-2 rounded-full border-2 border-[#e8a03e] border-t-transparent animate-[spin_0.8s_linear_infinite]"
              title="Query running in background"
            />
          )}
          {sessionStatuses?.has(session.sessionId) && session.sessionId !== activeSessionId && (() => {
            const status = sessionStatuses.get(session.sessionId)!
            const label = status === 'question' ? 'Question' : status === 'plan-review' ? 'Plan' : 'Permission'
            const title = status === 'question' ? 'Waiting for answer' : status === 'plan-review' ? 'Review plan' : 'Needs approval'
            return <span className={statusPillClass(status)} title={title}>{label}</span>
          })()}
          {session.customTitle || session.generatedTitle || session.summary || (isDraft ? 'New Chat' : (
            <span className="inline-block w-30 h-3 rounded bg-[linear-gradient(90deg,#2a2a3a_25%,#3a3a4a_50%,#2a2a3a_75%)] bg-size-[200%_100%] animate-shimmer" />
          ))}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 text-[0.72em] text-[#777]">
          <span>{timeAgo(session.lastModified)}</span>
          {session.provider === 'claude' && (
            <Sparkles size={11} className="text-accent shrink-0" />
          )}
          {session.provider === 'codex' && (
            <Terminal size={11} className="text-[#4aa3df] shrink-0" />
          )}
          {session.gitBranch && session.gitBranch !== 'HEAD' && (
            <span className="flex items-center gap-0.75 bg-[#1a2e1a] text-[#6cb86c] px-1.25 rounded-[3px] font-mono text-[0.9em] whitespace-nowrap overflow-hidden text-ellipsis max-w-25 max-[768px]:max-w-40">
              <GitBranch size={9} className="shrink-0" />
              {session.gitBranch}
            </span>
          )}
        </div>
        <button
          className="absolute right-2 top-1/2 -translate-y-1/2 bg-bg-tertiary border border-border text-text-faint rounded w-6 h-6 hidden items-center justify-center cursor-pointer transition-colors duration-150 group-hover:flex hover:text-[#ccc] hover:bg-border-subtle"
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
  }

  const renderProjectGroup = (cwd: string, groupSessions: SessionInfo[]) => {
    const isExpanded = expandedProjects.has(cwd)
    const hasActiveSessions = groupSessions.some(s =>
      backgroundQuerySessionIds?.has(s.sessionId) || sessionStatuses?.has(s.sessionId)
    )

    return (
      <div key={cwd}>
        <div
          className="flex items-center gap-1.5 px-2 py-2 cursor-pointer hover:bg-bg-card transition-colors duration-100 group/project max-[768px]:px-3 max-[768px]:py-2.5"
          onClick={() => toggleProject(cwd)}
        >
          <span className="text-text-dim shrink-0 w-4 flex items-center justify-center self-start mt-0.75">
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <FolderOpen size={14} className="text-text-dim shrink-0 self-start mt-0.75" />
          <div className="flex-1 min-w-0">
            <span className="block text-[0.85em] text-[#ccc] overflow-hidden text-ellipsis whitespace-nowrap max-[768px]:text-[0.9em]">
              {displayName(cwd)}
            </span>
            <span className="block text-[0.68em] text-[#555] overflow-hidden text-ellipsis whitespace-nowrap leading-tight">
              {cwd}
            </span>
          </div>
          {hasActiveSessions && (
            <span className="w-2 h-2 rounded-full bg-[#e8a03e] shrink-0" />
          )}
          <span className="text-[0.72em] text-[#555] shrink-0">
            {groupSessions.length}
          </span>
          <button
            className="bg-transparent border-none text-[#555] rounded w-6 h-6 hidden items-center justify-center cursor-pointer transition-colors duration-150 group-hover/project:flex hover:text-[#ccc] hover:bg-border-subtle"
            onClick={(e) => {
              e.stopPropagation()
              onNewChat('claude', cwd)
              if (window.innerWidth <= 768) onCloseSidebar?.()
            }}
            title="New chat in this project"
          >
            <Plus size={14} />
          </button>
          <div className="relative shrink-0" ref={contextMenuProject === cwd ? contextMenuRef : undefined}>
            <button
              className="bg-transparent border-none text-[#555] rounded w-6 h-6 hidden items-center justify-center cursor-pointer transition-colors duration-150 group-hover/project:flex hover:text-[#ccc] hover:bg-border-subtle"
              onClick={(e) => {
                e.stopPropagation()
                setContextMenuProject(prev => prev === cwd ? null : cwd)
              }}
              title="Project actions"
            >
              <MoreVertical size={14} />
            </button>
            {contextMenuProject === cwd && (
              <div className="absolute right-0 top-full mt-1 bg-bg-card border border-border rounded-md py-1 z-10 shadow-[0_4px_12px_rgba(0,0,0,0.4)] min-w-40">
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-[0.82em] text-[#ccc] bg-transparent border-none cursor-pointer hover:bg-[#2a2a3e] hover:text-white text-left"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenManageProject?.(cwd)
                    setContextMenuProject(null)
                  }}
                >
                  <Settings size={13} className="text-text-faint" /> Manage Project
                </button>
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-[0.82em] text-[#ccc] bg-transparent border-none cursor-pointer hover:bg-[#2a2a3e] hover:text-white text-left"
                  onClick={(e) => {
                    e.stopPropagation()
                    onNewChat('claude', cwd)
                    setContextMenuProject(null)
                    if (window.innerWidth <= 768) onCloseSidebar?.()
                  }}
                >
                  <Sparkles size={13} className="text-accent" /> New Chat Here
                </button>
                <div className="border-t border-border-subtle my-1" />
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-[0.82em] text-text-muted bg-transparent border-none cursor-pointer hover:bg-[#2a2a3e] hover:text-white text-left"
                  onClick={(e) => {
                    e.stopPropagation()
                    hideProject(cwd)
                    setContextMenuProject(null)
                  }}
                >
                  <EyeOff size={13} className="text-text-dim" /> Hide Project
                </button>
              </div>
            )}
          </div>
        </div>
        {isExpanded && groupSessions.map(renderSessionRow)}
      </div>
    )
  }

  return (
    <>
      {/* Sidebar backdrop (mobile only) */}
      {!isOpen && (
        <div
          className="hidden max-[768px]:block fixed inset-0 bg-black/50 z-199"
          onClick={onCloseSidebar}
        />
      )}

      <div
        className={[
          'w-75 h-screen bg-bg-secondary border-r border-border flex flex-col shrink-0 overflow-hidden',
          'transition-[margin-left] duration-200 ease-[ease]',
          'max-[768px]:fixed max-[768px]:top-0 max-[768px]:left-0 max-[768px]:w-full max-[768px]:h-dvh max-[768px]:z-200 max-[768px]:border-r-0 max-[768px]:transition-transform max-[768px]:duration-250',
          isOpen
            ? 'max-[768px]:translate-x-0'
            : '-ml-75 max-[768px]:ml-0 max-[768px]:-translate-x-full',
        ].join(' ')}
      >
        {/* Header */}
        <div className="p-3 flex gap-2 max-[768px]:p-4">
          <div
            className="flex flex-1 relative"
            ref={providerDropdownRef}
            onKeyDown={(e) => { if (e.key === 'Escape') setProviderDropdownOpen(false) }}
          >
            <button
              className={`flex-1 flex items-center justify-center gap-1.5 text-white border-none rounded-l-md py-2 text-[0.9em] font-medium cursor-pointer transition-colors duration-150 max-[768px]:min-h-11 max-[768px]:text-[1em] ${
                defaultProvider === 'codex'
                  ? 'bg-[#1a4a72] hover:bg-[#14406b]'
                  : 'bg-accent hover:bg-accent-hover'
              }`}
              onClick={() => { onNewChat(defaultProvider); setProviderDropdownOpen(false); if (window.innerWidth <= 768) onCloseSidebar?.() }}
            >
              {defaultProvider === 'codex'
                ? <Terminal size={13} className="opacity-75" />
                : <Sparkles size={13} className="opacity-75" />}
              New Chat
            </button>
            <button
              className={`text-white border-none border-l rounded-r-md px-2 cursor-pointer transition-colors duration-150 flex items-center max-[768px]:min-h-11 max-[768px]:px-3 ${
                defaultProvider === 'codex'
                  ? 'bg-[#14406b] border-[#0f3357] hover:bg-[#0e3050]'
                  : 'bg-accent-hover border-[#5a2a90] hover:bg-[#5a2a90]'
              }`}
              onClick={() => setProviderDropdownOpen(prev => !prev)}
              title="New chat with..."
            >
              <ChevronDown size={13} />
            </button>
            {providerDropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-bg-card border border-border rounded-md py-1 z-10 shadow-[0_4px_12px_rgba(0,0,0,0.4)]">
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-[0.85em] text-[#ccc] bg-transparent border-none cursor-pointer hover:bg-[#2a2a3e] hover:text-white text-left"
                  onClick={() => { onNewChat('claude'); setProviderDropdownOpen(false); if (window.innerWidth <= 768) onCloseSidebar?.() }}
                >
                  <Sparkles size={13} className="text-accent" /> New Chat with Claude
                </button>
                <button
                  className={`w-full flex items-center gap-2 px-3 py-2 text-[0.85em] bg-transparent border-none text-left ${
                    codexAvailable === false
                      ? 'text-[#555] cursor-not-allowed'
                      : 'text-[#ccc] cursor-pointer hover:bg-[#2a2a3e] hover:text-white'
                  }`}
                  onClick={codexAvailable !== false ? () => { onNewChat('codex'); setProviderDropdownOpen(false); if (window.innerWidth <= 768) onCloseSidebar?.() } : undefined}
                  disabled={codexAvailable === false}
                >
                  <Terminal size={13} className={codexAvailable === false ? 'text-[#444]' : 'text-[#4aa3df]'} />
                  New Chat with Codex
                  {codexAvailable === false && <span className="ml-auto text-[0.8em] text-[#555]">not configured</span>}
                </button>
              </div>
            )}
          </div>
          <button
          className="bg-border-subtle text-[#aaa] border border-[#444] rounded-md w-9 text-[1.1em] cursor-pointer flex items-center justify-center shrink-0 transition-colors duration-150 hover:bg-[#3a3a4a] hover:text-[#ddd] max-[768px]:min-h-11 max-[768px]:w-11"
            onClick={fetchSessions}
            title="Refresh sessions"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {/* Search bar */}
        <div className="px-3 py-2 border-b border-border-subtle flex items-center gap-1.5">
          <div className="flex-1 flex items-center bg-bg-tertiary rounded px-2 py-1.5 gap-1.5 max-[768px]:min-h-10">
            <Search size={14} className="text-[#555] shrink-0" />
            <input
              type="text"
              className="flex-1 bg-transparent border-none outline-none text-[0.85em] text-[#ccc] placeholder-[#555] min-w-0 max-[768px]:text-[0.9em]"
              placeholder="Search projects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                className="bg-transparent border-none text-text-dim cursor-pointer p-0 flex items-center hover:text-[#ccc]"
                onClick={() => setSearchQuery('')}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button
            className="bg-bg-tertiary text-text-faint border-none rounded w-8 h-8 cursor-pointer flex items-center justify-center shrink-0 transition-colors duration-150 hover:bg-[#252538] hover:text-[#ccc] max-[768px]:min-h-10 max-[768px]:w-10"
            onClick={handleBrowseFolder}
            title="Add project folder"
          >
            <Plus size={16} />
          </button>
        </div>

        {/* Archive toggle */}
        <div className="px-3 py-1">
          <button
            className={`bg-transparent border-none text-[0.78em] cursor-pointer flex items-center gap-1 px-1.5 py-1 rounded transition-colors duration-150 hover:text-[#aaa] hover:bg-bg-card ${showArchived ? 'text-accent' : 'text-text-dim'}`}
            onClick={onToggleShowArchived}
            title={showArchived ? 'Hide archived chats' : 'Show archived chats'}
          >
            <Archive size={13} />
            <span>{showArchived ? 'Showing archived' : 'Show archived'}</span>
          </button>
        </div>

        {/* Project groups */}
        <div className="flex-1 overflow-y-auto py-1 scroll-auto-hide">
          {!sessionsLoaded ? (
            <div className="px-4 py-5 text-text-dim text-[0.85em] text-center">Loading sessions...</div>
          ) : projectGroups.entries.length === 0 && projectGroups.ungrouped.length === 0 ? (
            <div className="px-4 py-5 text-text-dim text-[0.85em] text-center">
              {searchQuery ? 'No matching projects' : 'No projects yet'}
            </div>
          ) : (
            <>
              {projectGroups.entries.map(([cwd, group]) =>
                renderProjectGroup(cwd, group)
              )}
              {projectGroups.ungrouped.length > 0 && (
                <div>
                  <div
                    className="flex items-center gap-1.5 px-2 py-2 cursor-pointer hover:bg-bg-card transition-colors duration-100 max-[768px]:px-3 max-[768px]:py-2.5"
                    onClick={() => toggleProject('__ungrouped__')}
                  >
                    <span className="text-text-dim shrink-0 w-4 flex items-center justify-center">
                      {expandedProjects.has('__ungrouped__') ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </span>
                    <span className="flex-1 text-[0.85em] text-text-faint overflow-hidden text-ellipsis whitespace-nowrap italic max-[768px]:text-[0.9em]">
                      Other
                    </span>
                    <span className="text-[0.72em] text-[#555] shrink-0">
                      {projectGroups.ungrouped.length}
                    </span>
                  </div>
                  {expandedProjects.has('__ungrouped__') && projectGroups.ungrouped.map(renderSessionRow)}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-border-subtle text-[0.85em] max-[768px]:p-4 max-[768px]:pb-[max(16px,env(safe-area-inset-bottom))]">
          <SidebarProfile accountInfo={accountInfo} accountError={accountError} onOpenSettings={onOpenSettings} userProfile={userProfile} />
        </div>
      </div>
    </>
  )
}
