import { useEffect, useRef } from 'react'
import './FileMentionDropdown.css'

interface FileMentionDropdownProps {
  files: string[]
  query: string
  activeIndex: number
  onSelect: (file: string) => void
}

export function FileMentionDropdown({ files, query, activeIndex, onSelect }: FileMentionDropdownProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)

  const q = query.toLowerCase()
  const filtered = q
    ? files.filter((f) => f.toLowerCase().includes(q))
    : files

  const shown = filtered.slice(0, 15)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  if (shown.length === 0) {
    return (
      <div className="file-mention-dropdown">
        <div className="file-mention-empty">No matching files</div>
      </div>
    )
  }

  return (
    <div className="file-mention-dropdown" ref={listRef}>
      <div className="file-mention-header">Files</div>
      {shown.map((file, i) => (
        <div
          key={file}
          ref={i === activeIndex ? activeRef : undefined}
          className={`file-mention-item${i === activeIndex ? ' active' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault()
            onSelect(file)
          }}
        >
          <span className="file-mention-item-path">{file}</span>
        </div>
      ))}
    </div>
  )
}
