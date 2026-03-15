import { FolderOpen } from 'lucide-react'

interface FolderEmptyStateProps {
  onSelectFolder: () => void
}

export function FolderEmptyState({ onSelectFolder }: FolderEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 px-8 text-center select-none">
      <div className="w-14 h-14 rounded-2xl bg-bg-card border border-border flex items-center justify-center">
        <FolderOpen size={26} className="text-text-dim" />
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-[1em] font-semibold text-[#ccc] m-0">Select a project folder</h2>
        <p className="text-[0.85em] text-text-dim m-0 max-w-[280px] leading-relaxed">
          Choose a folder so the AI can read and edit your files.
        </p>
      </div>
      <button
        className="flex items-center gap-2 bg-accent text-white border-none rounded-lg px-5 py-2.5 text-[0.9em] font-medium cursor-pointer hover:opacity-90 active:opacity-80 transition-opacity"
        onClick={onSelectFolder}
      >
        <FolderOpen size={15} />
        Choose Folder
      </button>
    </div>
  )
}
