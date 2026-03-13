import { useEffect, useRef } from 'react'
import { BookOpen } from 'lucide-react'

interface FileMentionDropdownProps {
  files: string[]
  docSources: DocSource[]
  query: string
  activeIndex: number
  onSelect: (file: string) => void
  onSelectDoc: (doc: DocSource) => void
}

export function FileMentionDropdown({ files, docSources, query, activeIndex, onSelect, onSelectDoc }: FileMentionDropdownProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)

  const q = query.toLowerCase()

  // Filter doc sources (only show "ready" ones)
  const filteredDocs = docSources
    .filter(d => d.status === 'ready')
    .filter(d => !q || d.name.toLowerCase().includes(q) || d.url.toLowerCase().includes(q))
    .slice(0, 5)

  // Filter files
  const filteredFiles = q
    ? files.filter((f) => f.toLowerCase().includes(q))
    : files
  const shownFiles = filteredFiles.slice(0, 15)

  // Combined list for keyboard navigation: docs first, then files
  const totalItems = filteredDocs.length + shownFiles.length

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const dropdownClass = "absolute bottom-full left-0 right-0 mb-1 bg-[#1e1e2e] border border-[#444] rounded-lg max-h-60 overflow-y-auto z-[100] shadow-[0_-4px_16px_rgba(0,0,0,0.4)]"
  const headerClass = "px-3 py-1.5 text-[0.75em] text-[#888] uppercase tracking-[0.05em] border-b border-[#333]"
  const itemBase = "px-3 py-1.5 cursor-pointer font-mono text-[0.85em] text-[#ccc] flex items-center gap-2 hover:bg-[#2a2a3d] hover:text-white"
  const itemActive = "bg-[#2a2a3d] text-white"

  if (totalItems === 0) {
    return (
      <div className={dropdownClass}>
        <div className="p-3 text-[#666] text-[0.85em] text-center">No matches</div>
      </div>
    )
  }

  return (
    <div className={dropdownClass} ref={listRef}>
      {/* Docs section */}
      {filteredDocs.length > 0 && (
        <>
          <div className={headerClass}>Docs</div>
          {filteredDocs.map((doc, i) => (
            <div
              key={`doc-${doc.id}`}
              ref={i === activeIndex ? activeRef : undefined}
              className={`${itemBase}${i === activeIndex ? ` ${itemActive}` : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                onSelectDoc(doc)
              }}
            >
              <BookOpen size={12} className="shrink-0 mr-1.5 opacity-60" />
              <span className="overflow-hidden text-ellipsis whitespace-nowrap font-medium">{doc.name}</span>
              <span className="ml-2 text-[11px] opacity-50">{doc.url}</span>
            </div>
          ))}
        </>
      )}

      {/* Files section */}
      {shownFiles.length > 0 && (
        <>
          <div className={headerClass}>Files</div>
          {shownFiles.map((file, i) => {
            const globalIndex = filteredDocs.length + i
            return (
              <div
                key={file}
                ref={globalIndex === activeIndex ? activeRef : undefined}
                className={`${itemBase}${globalIndex === activeIndex ? ` ${itemActive}` : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  onSelect(file)
                }}
              >
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">{file}</span>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

/** Get total number of items in the unified dropdown for keyboard navigation */
export function getMentionItemCount(files: string[], docSources: DocSource[], query: string): number {
  const q = query.toLowerCase()
  const filteredDocs = docSources.filter(d => d.status === 'ready').filter(d => !q || d.name.toLowerCase().includes(q) || d.url.toLowerCase().includes(q)).slice(0, 5)
  const filteredFiles = (q ? files.filter((f) => f.toLowerCase().includes(q)) : files).slice(0, 15)
  return filteredDocs.length + filteredFiles.length
}

/** Resolve active index to either a file or doc selection */
export function resolveMentionIndex(files: string[], docSources: DocSource[], query: string, index: number): { type: 'file'; file: string } | { type: 'doc'; doc: DocSource } | null {
  const q = query.toLowerCase()
  const filteredDocs = docSources.filter(d => d.status === 'ready').filter(d => !q || d.name.toLowerCase().includes(q) || d.url.toLowerCase().includes(q)).slice(0, 5)
  const filteredFiles = (q ? files.filter((f) => f.toLowerCase().includes(q)) : files).slice(0, 15)

  if (index < filteredDocs.length) {
    return { type: 'doc', doc: filteredDocs[index] }
  }
  const fileIndex = index - filteredDocs.length
  if (fileIndex < filteredFiles.length) {
    return { type: 'file', file: filteredFiles[fileIndex] }
  }
  return null
}
