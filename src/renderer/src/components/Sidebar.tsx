import { useState, useEffect, useCallback, useRef } from 'react'
import { timeAgo } from '../utils/timeAgo'
import { parseSessionMessages } from '../utils/sessionParser'
import type { ChatMessage } from '../types'
import './Sidebar.css'

interface SidebarProps {
  isOpen: boolean
  activeSessionId: string | null
  isLoading: boolean
  autoApproveEdits: boolean
  onLoadSession: (sessionId: string, messages: ChatMessage[]) => void
  onNewChat: () => void
  onToggleAutoEdits: () => void
}

function folderName(path: string): string {
  return path.split('/').pop() || path
}

export function Sidebar({
  isOpen,
  activeSessionId,
  isLoading,
  autoApproveEdits,
  onLoadSession,
  onNewChat,
  onToggleAutoEdits,
}: SidebarProps) {
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null)
  const [loadingSession, setLoadingSession] = useState<string | null>(null)
  const [selectedFolder, setSelectedFolder] = useState<string | null>(() => {
    return localStorage.getItem('selected-folder') || null
  })
  const [recentFolders, setRecentFolders] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('recent-folders') || '[]') }
    catch { return [] }
  })
  const [showRecents, setShowRecents] = useState(false)
  const recentsRef = useRef<HTMLDivElement>(null)

  const fetchSessions = useCallback(async () => {
    try {
      const list = await window.claude.listSessions()
      setSessions(list)
    } catch {
      // Silently handle — sessions may not be available
    }
  }, [])

  useEffect(() => {
    fetchSessions()

    window.claude.getAccountInfo().then((info) => {
      setAccountInfo(info)
    }).catch(() => {})

    const unsub = window.claude.onSessionRefreshHint(() => {
      fetchSessions()
    })

    return unsub
  }, [fetchSessions])

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

  const filteredSessions = selectedFolder
    ? sessions.filter(s => s.cwd === selectedFolder || s.cwd?.startsWith(selectedFolder + '/'))
    : sessions

  const handleSessionClick = async (sessionId: string) => {
    if (isLoading || loadingSession) return
    if (sessionId === activeSessionId) return

    setLoadingSession(sessionId)
    try {
      const raw = await window.claude.getSessionMessages(sessionId)
      const parsed = parseSessionMessages(raw)
      onLoadSession(sessionId, parsed)
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
    setRecentFolders(prev => {
      const next = [folder, ...prev.filter(f => f !== folder)].slice(0, 10)
      localStorage.setItem('recent-folders', JSON.stringify(next))
      return next
    })
    setShowRecents(false)
  }

  const handleClearFolder = () => {
    setSelectedFolder(null)
    localStorage.removeItem('selected-folder')
    setShowRecents(false)
  }

  const handlePickRecent = (folder: string) => {
    setSelectedFolder(folder)
    localStorage.setItem('selected-folder', folder)
    setShowRecents(false)
  }

  return (
    <div className={`sidebar ${isOpen ? '' : 'collapsed'}`}>
      <div className="sidebar-header">
        <button className="btn-new-chat" onClick={onNewChat}>
          + New Chat
        </button>
      </div>

      <div className="folder-selector" ref={recentsRef}>
        <div className="folder-row">
          <div
            className="folder-current"
            onClick={() => setShowRecents(prev => !prev)}
          >
            <span className="folder-label">
              {selectedFolder ? folderName(selectedFolder) : 'All Projects'}
            </span>
            <span className="folder-chevron">{showRecents ? '▴' : '▾'}</span>
          </div>
          {selectedFolder && (
            <button className="folder-clear" onClick={handleClearFolder} title="Show all projects">
              ×
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
            {recentFolders
              .filter(f => f !== selectedFolder)
              .map(folder => (
                <div
                  key={folder}
                  className="folder-dropdown-item"
                  onClick={() => handlePickRecent(folder)}
                >
                  <span className="folder-item-name">{folderName(folder)}</span>
                  <span className="folder-item-path">{folder}</span>
                </div>
              ))}
            <div className="folder-dropdown-item folder-browse" onClick={handleBrowseFolder}>
              Browse...
            </div>
          </div>
        )}
      </div>

      <div className="sidebar-sessions">
        {filteredSessions.length === 0 ? (
          <div className="sidebar-empty">
            {selectedFolder ? 'No sessions in this project' : 'No previous chats'}
          </div>
        ) : (
          filteredSessions.map((session) => (
            <div
              key={session.sessionId}
              className={`session-item ${session.sessionId === activeSessionId ? 'active' : ''} ${loadingSession === session.sessionId ? 'loading' : ''}`}
              onClick={() => handleSessionClick(session.sessionId)}
            >
              <div className="session-summary">
                {session.customTitle || session.summary || session.firstPrompt || 'Untitled'}
              </div>
              <div className="session-meta">
                <span>{timeAgo(session.lastModified)}</span>
                {session.cwd && !selectedFolder && (
                  <span className="project-name">{folderName(session.cwd)}</span>
                )}
                {session.gitBranch && (
                  <span className="git-branch-badge">{session.gitBranch}</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="sidebar-footer">
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={autoApproveEdits}
            onChange={onToggleAutoEdits}
          />
          Auto-approve edits
        </label>

        <div className="auth-info">
          {accountInfo ? (
            <>
              {accountInfo.email && <div className="auth-email">{accountInfo.email}</div>}
              {accountInfo.organization && <div className="auth-org">{accountInfo.organization}</div>}
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
            <div className="auth-status-unknown">Checking auth...</div>
          )}
        </div>
      </div>
    </div>
  )
}
