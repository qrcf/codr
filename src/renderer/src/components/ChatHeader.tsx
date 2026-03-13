import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { timeAgo } from '../utils/timeAgo'

function truncate(s: string | undefined, max: number): string {
  if (!s) return ''
  return s.length > max ? s.slice(0, max) + '...' : s
}

interface ChatHeaderProps {
  sidebarOpen: boolean
  onToggleSidebar: () => void
  projectTitle: string
  activeSession: SessionInfo | null
}

export function ChatHeader({ sidebarOpen, onToggleSidebar, projectTitle, activeSession }: ChatHeaderProps) {
  return (
    <header className="flex items-center gap-3 px-4 py-3 border-b border-[#333] flex-shrink-0 max-[768px]:px-3 max-[768px]:py-[10px] max-[768px]:gap-2">
      <button className="bg-transparent border border-[#444] rounded text-[#aaa] w-7 h-7 flex items-center justify-center cursor-pointer text-[0.7em] p-0 flex-shrink-0 transition-[background] duration-150 hover:bg-[#2a2a3a] hover:text-[#ddd]" onClick={onToggleSidebar}>
        {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
      </button>
      <div className="flex flex-col flex-shrink-0">
        <h1 className="text-[1.2em] m-0 font-semibold max-[768px]:text-[1em]">{projectTitle}</h1>
        {activeSession?.cwd && (
          <span className="text-[0.7em] text-[#666] overflow-hidden text-ellipsis whitespace-nowrap max-w-[300px]">
            {activeSession.cwd}
          </span>
        )}
      </div>
      {activeSession && (activeSession.customTitle || activeSession.generatedTitle) && (
        <div className="relative flex-1 min-w-0 group">
          <span className="block text-[#999] text-[0.85em] whitespace-nowrap overflow-hidden text-ellipsis cursor-default">
            {activeSession.customTitle || activeSession.generatedTitle}
          </span>
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
    </header>
  )
}
