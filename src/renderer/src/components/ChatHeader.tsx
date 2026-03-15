import { useState, useEffect, useRef } from 'react'
import { PanelLeftClose, PanelLeftOpen, ChevronDown, Search, ClipboardList, Settings, RefreshCw } from 'lucide-react'
import { timeAgo } from '../utils/timeAgo'

function truncate(s: string | undefined, max: number): string {
  if (!s) return ''
  return s.length > max ? s.slice(0, max) + '...' : s
}

interface ProjectOption {
  path: string
  displayName: string
}

interface ChatHeaderProps {
  sidebarOpen: boolean
  onToggleSidebar: () => void
  projectTitle: string
  activeSession: SessionInfo | null
  isDraft?: boolean
  allProjects?: ProjectOption[]
  onChangeProject?: (cwd: string) => void
  approvedPlan?: { content: string; filePath: string } | null
  onShowPlan?: () => void
  onOpenManageProject?: (folderPath: string) => void
  onRegenTitle?: (sessionId: string, firstPrompt: string) => Promise<void>
}

export function ChatHeader({ sidebarOpen, onToggleSidebar, projectTitle, activeSession, isDraft, allProjects, onChangeProject, approvedPlan, onShowPlan, onOpenManageProject, onRegenTitle }: ChatHeaderProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
        setSearchQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropdownOpen])

  // Close on Escape
  useEffect(() => {
    if (!dropdownOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDropdownOpen(false)
        setSearchQuery('')
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [dropdownOpen])

  // Focus search input when dropdown opens
  useEffect(() => {
    if (dropdownOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 0)
    }
  }, [dropdownOpen])

  const filteredProjects = (allProjects || []).filter(p => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return p.displayName.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
  })

  const canSwitchProject = isDraft && allProjects && allProjects.length > 0

  return (
    <header className="flex items-center gap-3 px-4 py-3 border-b border-[#333] flex-shrink-0 max-[768px]:px-3 max-[768px]:py-[10px] max-[768px]:gap-2">
      <button className="bg-transparent border border-[#444] rounded text-[#aaa] w-7 h-7 flex items-center justify-center cursor-pointer text-[0.7em] p-0 flex-shrink-0 transition-[background] duration-150 hover:bg-[#2a2a3a] hover:text-[#ddd]" onClick={onToggleSidebar}>
        {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
      </button>
      <div className="flex flex-col flex-shrink-0 relative" ref={dropdownRef}>
        <div
          className={`flex items-center gap-1.5 ${canSwitchProject ? 'cursor-pointer group/project-switcher' : ''}`}
          onClick={() => {
            if (canSwitchProject) setDropdownOpen(prev => !prev)
          }}
        >
          <h1 className={`text-[1.2em] m-0 font-semibold max-[768px]:text-[1em] ${canSwitchProject ? 'group-hover/project-switcher:text-[#b388ff]' : ''}`}>
            {projectTitle}
          </h1>
          {canSwitchProject && (
            <ChevronDown
              size={14}
              className={`text-[#666] transition-transform duration-150 ${dropdownOpen ? 'rotate-180 text-[#999]' : 'group-hover/project-switcher:text-[#999]'}`}
            />
          )}
        </div>
        {activeSession?.cwd && (
          <span className="text-[0.7em] text-[#666] overflow-hidden text-ellipsis whitespace-nowrap max-w-[300px]">
            {activeSession.cwd}
          </span>
        )}

        {/* Project switcher dropdown */}
        {dropdownOpen && canSwitchProject && (
          <div className="absolute top-full left-0 mt-1 w-[320px] bg-[#1e1e2e] border border-[#333] rounded-lg py-1 z-[100] shadow-[0_4px_16px_rgba(0,0,0,0.5)]">
            <div className="px-2 py-1.5 border-b border-[#2a2a3a]">
              <div className="flex items-center gap-1.5 bg-[#161622] rounded px-2 py-1.5">
                <Search size={13} className="text-[#555] shrink-0" />
                <input
                  ref={searchInputRef}
                  type="text"
                  className="flex-1 bg-transparent border-none outline-none text-[0.82em] text-[#ccc] placeholder-[#555] min-w-0"
                  placeholder="Search projects..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
            <div className="max-h-[280px] overflow-y-auto py-1">
              {filteredProjects.length === 0 ? (
                <div className="px-3 py-2 text-[0.8em] text-[#666] text-center">No matching projects</div>
              ) : (
                filteredProjects.map(p => {
                  const isCurrentProject = activeSession?.cwd === p.path
                  return (
                    <button
                      key={p.path}
                      className={`w-full flex flex-col px-3 py-2 bg-transparent border-none cursor-pointer text-left transition-colors duration-100 hover:bg-[#2a2a3e] ${isCurrentProject ? 'bg-[#2a2a3e]' : ''}`}
                      onClick={() => {
                        onChangeProject?.(p.path)
                        setDropdownOpen(false)
                        setSearchQuery('')
                      }}
                    >
                      <span className={`text-[0.85em] ${isCurrentProject ? 'text-[#b388ff]' : 'text-[#ccc]'}`}>
                        {p.displayName}
                      </span>
                      <span className="text-[0.7em] text-[#555] overflow-hidden text-ellipsis whitespace-nowrap">
                        {p.path}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>
      {activeSession?.cwd && onOpenManageProject && (
        <button
          className="bg-transparent border-none text-[#555] p-1 rounded cursor-pointer transition-colors duration-150 hover:text-[#ccc] hover:bg-[#2a2a3a] flex-shrink-0"
          onClick={() => onOpenManageProject(activeSession.cwd!)}
          title="Manage project"
        >
          <Settings size={13} />
        </button>
      )}
      {activeSession && !activeSession.sessionId.startsWith('draft-') && (
        <div className="relative flex-1 min-w-0 group flex items-center gap-1">
          {(activeSession.customTitle || activeSession.generatedTitle) && (
            <span className="block text-[#999] text-[0.85em] whitespace-nowrap overflow-hidden text-ellipsis cursor-default min-w-0">
              {activeSession.customTitle || activeSession.generatedTitle}
            </span>
          )}
          {onRegenTitle && (activeSession.firstPrompt || activeSession.summary) && (
            <button
              className={`hidden group-hover:flex items-center justify-center flex-shrink-0 bg-transparent border-none text-[#555] p-0.5 rounded cursor-pointer transition-colors duration-150 hover:text-[#aaa] ${isRegenerating ? '!flex' : ''}`}
              title="Regenerate title"
              onClick={async (e) => {
                e.stopPropagation()
                if (isRegenerating) return
                setIsRegenerating(true)
                try {
                  await onRegenTitle(activeSession.sessionId, activeSession.firstPrompt || activeSession.summary || '')
                } finally {
                  setIsRegenerating(false)
                }
              }}
            >
              <RefreshCw size={11} className={isRegenerating ? 'animate-spin' : ''} />
            </button>
          )}
          <div className="hidden group-hover:block max-[768px]:!hidden absolute top-full left-0 min-w-[280px] max-w-[420px] bg-[#1e1e2e] border border-[#333] rounded-lg px-3 pb-[10px] pt-[18px] z-[100] shadow-[0_4px_16px_rgba(0,0,0,0.5)]" onClick={(e) => {
            const target = e.target as HTMLElement
            if (target.classList.contains('tooltip-value')) {
              const text = target.textContent || ''
              navigator.clipboard.writeText(text)
              target.classList.add('copied')
              setTimeout(() => target.classList.remove('copied'), 600)
            }
          }}>
            {activeSession.summary && (
              <div className="flex gap-[10px] py-1 text-[0.8em] leading-[1.4] [&+&]:border-t [&+&]:border-[#2a2a3a]">
                <span className="text-[#666] flex-shrink-0 min-w-[90px]">SDK Summary</span>
                <span className="tooltip-value text-[#ccc] break-words cursor-pointer rounded px-1 py-[1px] -mx-1 -my-[1px] transition-[background] duration-150 hover:bg-[#2a2a3a]">{activeSession.summary}</span>
              </div>
            )}
            {activeSession.generatedTitle && (
              <div className="flex gap-[10px] py-1 text-[0.8em] leading-[1.4] [&+&]:border-t [&+&]:border-[#2a2a3a]">
                <span className="text-[#666] flex-shrink-0 min-w-[90px]">Generated Title</span>
                <span className="tooltip-value text-[#ccc] break-words cursor-pointer rounded px-1 py-[1px] -mx-1 -my-[1px] transition-[background] duration-150 hover:bg-[#2a2a3a]">{activeSession.generatedTitle}</span>
              </div>
            )}
            {activeSession.customTitle && (
              <div className="flex gap-[10px] py-1 text-[0.8em] leading-[1.4] [&+&]:border-t [&+&]:border-[#2a2a3a]">
                <span className="text-[#666] flex-shrink-0 min-w-[90px]">Custom Title</span>
                <span className="tooltip-value text-[#ccc] break-words cursor-pointer rounded px-1 py-[1px] -mx-1 -my-[1px] transition-[background] duration-150 hover:bg-[#2a2a3a]">{activeSession.customTitle}</span>
              </div>
            )}
            {activeSession.firstPrompt && (
              <div className="flex gap-[10px] py-1 text-[0.8em] leading-[1.4] [&+&]:border-t [&+&]:border-[#2a2a3a]">
                <span className="text-[#666] flex-shrink-0 min-w-[90px]">First Prompt</span>
                <span className="tooltip-value text-[#ccc] break-words cursor-pointer rounded px-1 py-[1px] -mx-1 -my-[1px] transition-[background] duration-150 hover:bg-[#2a2a3a]">{truncate(activeSession.firstPrompt, 120)}</span>
              </div>
            )}
            {activeSession.cwd && (
              <div className="flex gap-[10px] py-1 text-[0.8em] leading-[1.4] [&+&]:border-t [&+&]:border-[#2a2a3a]">
                <span className="text-[#666] flex-shrink-0 min-w-[90px]">Project</span>
                <span className="tooltip-value text-[#ccc] break-words cursor-pointer rounded px-1 py-[1px] -mx-1 -my-[1px] transition-[background] duration-150 hover:bg-[#2a2a3a]">{activeSession.cwd}</span>
              </div>
            )}
            {activeSession.gitBranch && activeSession.gitBranch !== 'HEAD' && (
              <div className="flex gap-[10px] py-1 text-[0.8em] leading-[1.4] [&+&]:border-t [&+&]:border-[#2a2a3a]">
                <span className="text-[#666] flex-shrink-0 min-w-[90px]">Branch</span>
                <span className="tooltip-value text-[#ccc] break-words cursor-pointer rounded px-1 py-[1px] -mx-1 -my-[1px] transition-[background] duration-150 hover:bg-[#2a2a3a]">{activeSession.gitBranch}</span>
              </div>
            )}
            <div className="flex gap-[10px] py-1 text-[0.8em] leading-[1.4] [&+&]:border-t [&+&]:border-[#2a2a3a]">
              <span className="text-[#666] flex-shrink-0 min-w-[90px]">Last Modified</span>
              <span className="tooltip-value text-[#ccc] break-words cursor-pointer rounded px-1 py-[1px] -mx-1 -my-[1px] transition-[background] duration-150 hover:bg-[#2a2a3a]">{timeAgo(activeSession.lastModified)}</span>
            </div>
            <div className="flex gap-[10px] py-1 text-[0.8em] leading-[1.4] [&+&]:border-t [&+&]:border-[#2a2a3a]">
              <span className="text-[#666] flex-shrink-0 min-w-[90px]">Session ID</span>
              <span className="tooltip-value text-[#ccc] break-words cursor-pointer rounded px-1 py-[1px] -mx-1 -my-[1px] transition-[background] duration-150 hover:bg-[#2a2a3a] font-['SF_Mono','Fira_Code','Cascadia_Code',monospace] text-[0.9em] opacity-70">{activeSession.sessionId}</span>
            </div>
            <div className="flex gap-[10px] py-1 text-[0.8em] leading-[1.4] [&+&]:border-t [&+&]:border-[#2a2a3a]">
              <span className="text-[#666] flex-shrink-0 min-w-[90px]">File Size</span>
              <span className="tooltip-value text-[#ccc] break-words cursor-pointer rounded px-1 py-[1px] -mx-1 -my-[1px] transition-[background] duration-150 hover:bg-[#2a2a3a]">{activeSession.fileSize < 1024 ? `${activeSession.fileSize} B` : `${(activeSession.fileSize / 1024).toFixed(1)} KB`}</span>
            </div>
          </div>
        </div>
      )}
      {approvedPlan && (
        <button
          className="ml-auto flex items-center gap-1.5 bg-transparent border border-[#3a4a4a] text-[#78c0a8] rounded-md px-3 py-1.5 text-[0.8em] font-medium cursor-pointer hover:bg-[#242a2a] transition-colors flex-shrink-0"
          onClick={onShowPlan}
        >
          <ClipboardList size={14} />
          Show Plan
        </button>
      )}
    </header>
  )
}
