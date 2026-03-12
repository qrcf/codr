import { useEffect, useRef } from 'react'
import { BookOpen } from 'lucide-react'
import './FileMentionDropdown.css'

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

  if (totalItems === 0) {
    return (
      <div className="file-mention-dropdown">
        <div className="file-mention-empty">No matches</div>
      </div>
    )
  }

  return (
    <div className="file-mention-dropdown" ref={listRef}>
      {/* Docs section */}
      {filteredDocs.length > 0 && (
        <>
          <div className="file-mention-header">Docs</div>
          {filteredDocs.map((doc, i) => (
            <div
              key={`doc-${doc.id}`}
              ref={i === activeIndex ? activeRef : undefined}
              className={`file-mention-item${i === activeIndex ? ' active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                onSelectDoc(doc)
              }}
            >
              <BookOpen size={12} style={{ flexShrink: 0, marginRight: '6px', opacity: 0.6 }} />
              <span className="file-mention-item-path" style={{ fontWeight: 500 }}>{doc.name}</span>
              <span style={{ marginLeft: '8px', fontSize: '11px', opacity: 0.5 }}>{doc.url}</span>
            </div>
          ))}
        </>
      )}

      {/* Files section */}
      {shownFiles.length > 0 && (
        <>
          <div className="file-mention-header">Files</div>
          {shownFiles.map((file, i) => {
            const globalIndex = filteredDocs.length + i
            return (
              <div
                key={file}
                ref={globalIndex === activeIndex ? activeRef : undefined}
                className={`file-mention-item${globalIndex === activeIndex ? ' active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  onSelect(file)
                }}
              >
                <span className="file-mention-item-path">{file}</span>
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
