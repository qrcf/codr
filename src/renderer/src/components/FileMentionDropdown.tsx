import { useEffect, useRef } from 'react'
import { BookOpen, Sparkles } from 'lucide-react'

interface FileMentionDropdownProps {
  files: string[]
  docSources: DocSource[]
  query: string
  activeIndex: number
  onSelect: (file: string) => void
  onSelectDoc: (doc: DocSource) => void
  onFindReferences?: () => void
  indexerStatus?: string
  projectIndexStatus?: string
}

export function FileMentionDropdown({ files, docSources, query, activeIndex, onSelect, onSelectDoc, onFindReferences, indexerStatus, projectIndexStatus }: FileMentionDropdownProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)

  const q = query.toLowerCase()
  // Both global indexer AND project must be ready for search to work
  const indexerReady = indexerStatus === 'ready' && projectIndexStatus === 'indexed'

  // "Find references..." row shows at index 0 when query is empty (always, regardless of indexer status)
  const showFindRefs = !q && !!onFindReferences

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

  // Combined list for keyboard navigation: find-refs (optional) + docs + files
  const offset = showFindRefs ? 1 : 0
  const totalItems = offset + filteredDocs.length + shownFiles.length

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
      {/* Find references row */}
      {showFindRefs && (
        <div
          ref={activeIndex === 0 ? activeRef : undefined}
          className={`${itemBase} border-b border-[#333] font-sans${activeIndex === 0 ? ` ${itemActive}` : ''}`}
          title={
            indexerReady
              ? 'Search your project index for relevant files'
              : indexerStatus !== 'ready'
                ? indexerStatus === 'setting-up'
                  ? 'Indexer is installing — please wait'
                  : 'Indexer is not installed'
                : projectIndexStatus === 'indexing'
                  ? 'Index is building — results may be incomplete'
                  : projectIndexStatus === 'error'
                    ? 'Index error — try rebuilding from Project Settings'
                    : 'Project not indexed — build index from Project Settings'
          }
          onMouseDown={(e) => {
            e.preventDefault()
            onFindReferences?.()
          }}
        >
          <Sparkles size={12} className="shrink-0 text-[#a78bfa]" />
          <span className="font-medium text-[#a78bfa]">Find references...</span>
          {!indexerReady && (
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ml-auto ${
              indexerStatus === 'setting-up' || projectIndexStatus === 'indexing'
                ? 'bg-[#d4a845] animate-pulse'
                : 'bg-[#e06060]'
            }`} />
          )}
        </div>
      )}

      {/* Docs section */}
      {filteredDocs.length > 0 && (
        <>
          <div className={headerClass}>Docs</div>
          {filteredDocs.map((doc, i) => {
            const globalIndex = offset + i
            return (
              <div
                key={`doc-${doc.id}`}
                ref={globalIndex === activeIndex ? activeRef : undefined}
                className={`${itemBase}${globalIndex === activeIndex ? ` ${itemActive}` : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  onSelectDoc(doc)
                }}
              >
                <BookOpen size={12} className="shrink-0 mr-1.5 opacity-60" />
                <span className="overflow-hidden text-ellipsis whitespace-nowrap font-medium">{doc.name}</span>
                <span className="ml-2 text-[11px] opacity-50">{doc.url}</span>
              </div>
            )
          })}
        </>
      )}

      {/* Files section */}
      {shownFiles.length > 0 && (
        <>
          <div className={headerClass}>Files</div>
          {shownFiles.map((file, i) => {
            const globalIndex = offset + filteredDocs.length + i
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

