import { useState } from 'react'
import { File as FileIcon, FileText, Image, FileType2, X } from 'lucide-react'

function categoryIcon(category: AttachmentMeta['category']) {
  switch (category) {
    case 'image': return <Image size={12} className="shrink-0" />
    case 'pdf': return <FileType2 size={12} className="shrink-0" />
    case 'text': return <FileText size={12} className="shrink-0" />
    default: return <FileIcon size={12} className="shrink-0" />
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Attachment chips for the input composer (before sending). Includes remove buttons. */
export function InputAttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: AttachmentMeta[]
  onRemove: (id: string) => void
}) {
  if (!attachments.length) return null
  return (
    <>
      {attachments.map(att => (
        <span
          key={att.id}
          className="inline-flex items-center gap-1 bg-[#3a3a50] text-[#ccc] px-2 py-0.5 rounded text-[0.82em]"
          title={`${att.originalName} (${formatSize(att.sizeBytes)})`}
        >
          {att.category === 'image' && att.thumbnailDataUrl ? (
            <img
              src={att.thumbnailDataUrl}
              alt={att.originalName}
              className="w-6 h-6 rounded object-cover shrink-0"
            />
          ) : (
            categoryIcon(att.category)
          )}
          <span className="max-w-32 truncate">{att.originalName}</span>
          <button
            className="bg-transparent border-none text-text-muted cursor-pointer px-0.5 py-0 text-[12px] leading-none hover:text-white"
            onClick={() => onRemove(att.id)}
          >
            <X size={10} />
          </button>
        </span>
      ))}
    </>
  )
}

/** Attachment chips for message display (after sending). Clickable to preview. */
export function MessageAttachmentChips({
  attachments,
}: {
  attachments: AttachmentMeta[]
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (!attachments.length) return null

  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {attachments.map(att => {
        const isExpanded = expandedId === att.id
        return (
          <div key={att.id} className="flex flex-col">
            <button
              className="inline-flex items-center gap-1.5 bg-[#2a2a3e] text-[#bbb] px-2 py-1 rounded-md text-[0.78em] border border-[#3a3a50] cursor-pointer hover:bg-[#333350] hover:text-white transition-colors duration-100"
              onClick={() => setExpandedId(isExpanded ? null : att.id)}
              title={`${att.originalName} (${formatSize(att.sizeBytes)})`}
            >
              {att.category === 'image' && att.thumbnailDataUrl ? (
                <img
                  src={att.thumbnailDataUrl}
                  alt={att.originalName}
                  className="w-5 h-5 rounded object-cover shrink-0"
                />
              ) : (
                categoryIcon(att.category)
              )}
              <span className="max-w-40 truncate">{att.originalName}</span>
              <span className="text-text-dim text-[0.85em]">{formatSize(att.sizeBytes)}</span>
            </button>
            {isExpanded && att.category === 'image' && att.thumbnailDataUrl && (
              <div className="mt-1 rounded-lg overflow-hidden border border-[#3a3a50] max-w-80">
                <img
                  src={att.thumbnailDataUrl}
                  alt={att.originalName}
                  className="w-full h-auto"
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
