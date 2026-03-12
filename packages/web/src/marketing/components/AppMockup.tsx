import { ChevronRight, PanelLeftClose, ChevronDown, Settings, RefreshCw, BookOpen, X } from 'lucide-react'

/**
 * Static mockup of the actual Codr app UI for the marketing hero section.
 * Pure presentational — no interactivity, no app dependencies.
 * Matches real app layout/colors from src/renderer/src/App.css + Sidebar.css.
 */
export default function AppMockup() {
  return (
    <div className="mk-mockup">
      {/* ── Window chrome ── */}
      <div className="mk-mockup__bar">
        <span className="mk-mockup__dot mk-mockup__dot--red" />
        <span className="mk-mockup__dot mk-mockup__dot--yellow" />
        <span className="mk-mockup__dot mk-mockup__dot--green" />
        <span className="mk-mockup__bar-title">codr</span>
      </div>

      <div className="mk-mockup__body">
        {/* ── Sidebar ── */}
        <div className="mk-mockup__sidebar">
          <div className="mk-mockup__sidebar-header">
            <button className="mk-mockup__new-chat">+ New Chat</button>
            <span className="mk-mockup__refresh"><RefreshCw size={11} /></span>
          </div>

          <div className="mk-mockup__folder-area">
            <div className="mk-mockup__folder-current">
              <span className="mk-mockup__folder-label">my-project</span>
              <span className="mk-mockup__folder-chevron"><ChevronDown size={10} /></span>
            </div>
            <div className="mk-mockup__manage-project">Manage Project</div>
          </div>

          <div className="mk-mockup__sessions">
            <div className="mk-mockup__session mk-mockup__session--active">
              <div className="mk-mockup__session-summary">Add JWT authentication</div>
              <div className="mk-mockup__session-meta">
                <span>2m ago</span>
                <span className="mk-mockup__git-branch">main</span>
              </div>
            </div>
            <div className="mk-mockup__session">
              <div className="mk-mockup__session-summary">Fix pagination bug</div>
              <div className="mk-mockup__session-meta">
                <span>1h ago</span>
                <span className="mk-mockup__git-branch">fix/pagination</span>
              </div>
            </div>
            <div className="mk-mockup__session">
              <div className="mk-mockup__session-summary">Refactor user service</div>
              <div className="mk-mockup__session-meta"><span>3h ago</span></div>
            </div>
            <div className="mk-mockup__session">
              <div className="mk-mockup__session-summary">Add unit tests for utils</div>
              <div className="mk-mockup__session-meta"><span>yesterday</span></div>
            </div>
          </div>

          <div className="mk-mockup__sidebar-footer">
            <div className="mk-mockup__auth-info">
              <div className="mk-mockup__email">dev@example.com</div>
              <div className="mk-mockup__auth-badges">
                <span className="mk-mockup__auth-badge">Pro</span>
              </div>
            </div>
            <span className="mk-mockup__settings-gear"><Settings size={11} /></span>
          </div>
        </div>

        {/* ── Main area ── */}
        <div className="mk-mockup__main">
          {/* Header */}
          <div className="mk-mockup__header">
            <span className="mk-mockup__toggle-btn"><PanelLeftClose size={12} /></span>
            <span className="mk-mockup__project-title">my-project</span>
            <span className="mk-mockup__session-label">Add JWT authentication</span>
          </div>

          {/* Messages */}
          <div className="mk-mockup__messages">
            {/* User message */}
            <div className="mk-mockup__msg mk-mockup__msg--user">
              <div className="mk-mockup__msg-bubble">
                Add authentication to the API routes using JWT tokens
              </div>
            </div>

            {/* Assistant message with plan */}
            <div className="mk-mockup__msg mk-mockup__msg--assistant">
              <div className="mk-mockup__msg-text">
                I've analyzed your codebase and created a plan for adding JWT auth. Here's what I'll do:
              </div>
              {/* Plan review block */}
              <div className="mk-mockup__plan-block">
                <span className="mk-mockup__plan-icon">📋</span>
                <span className="mk-mockup__plan-label">Plan ready for review</span>
                <span className="mk-mockup__plan-actions">
                  <span className="mk-mockup__plan-btn mk-mockup__plan-btn--approve">Approve</span>
                  <span className="mk-mockup__plan-btn mk-mockup__plan-btn--edit">Edit</span>
                </span>
              </div>
              <div className="mk-mockup__tool-group">
                <span className="mk-mockup__tool-chevron"><ChevronRight size={10} /></span>
                <span className="mk-mockup__tool-summary">Read 3 files, edited 2 files, wrote 1 file</span>
              </div>
              <div className="mk-mockup__msg-text">
                Done. JWT authentication is now active on all <code>/api/*</code> routes.
              </div>
            </div>
          </div>

          {/* Input area */}
          <div className="mk-mockup__input-area">
            {/* File tags row */}
            <div className="mk-mockup__file-tags">
              <span className="mk-mockup__file-tag">
                <span>auth.ts</span>
                <span className="mk-mockup__file-tag-x"><X size={8} /></span>
              </span>
              <span className="mk-mockup__file-tag mk-mockup__file-tag--doc">
                <BookOpen size={9} />
                <span>React Docs</span>
                <span className="mk-mockup__file-tag-x"><X size={8} /></span>
              </span>
            </div>
            <div className="mk-mockup__input-field">
              <span className="mk-mockup__input-placeholder">Send a message...</span>
            </div>
            <div className="mk-mockup__input-toolbar">
              <div className="mk-mockup__toolbar-left">
                <div className="mk-mockup__mode-selector">
                  <span className="mk-mockup__mode-btn mk-mockup__mode-btn--active">Plan</span>
                  <span className="mk-mockup__mode-btn">Code</span>
                  <span className="mk-mockup__mode-btn mk-mockup__mode-btn--last">Ask</span>
                </div>
                <label className="mk-mockup__allow-edits">
                  <span className="mk-mockup__toggle-track">
                    <span className="mk-mockup__toggle-thumb" />
                  </span>
                  <span>Allow edits</span>
                </label>
              </div>
              <div className="mk-mockup__toolbar-right">
                <span className="mk-mockup__send-btn">Send</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
