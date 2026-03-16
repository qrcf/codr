import { useState } from 'react'
import { CornerDownLeft, Trash2, Pencil, ChevronDown, ListOrdered } from 'lucide-react'
import type { QueuedMessage } from '../../hooks/useMessageQueue'

interface QueuedMessageAccordionProps {
  messages: QueuedMessage[]
  onSendNow: (id: string) => void
  onEdit: (id: string) => void
  onRemove: (id: string) => void
}

export function QueuedMessageAccordion({ messages, onSendNow, onEdit, onRemove }: QueuedMessageAccordionProps) {
  const [expanded, setExpanded] = useState(true)
  const count = messages.length

  return (
    <div className="rounded-lg border border-border bg-bg-tertiary overflow-hidden mb-2">
      {/* Header */}
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-[0.78em] text-text-faint bg-transparent border-none cursor-pointer transition-colors duration-150 hover:text-text-muted"
        onClick={() => setExpanded(e => !e)}
      >
        <ListOrdered size={12} className="shrink-0 opacity-60" />
        <span>{count} queued message{count !== 1 ? 's' : ''}</span>
        <ChevronDown size={10} className={`ml-auto transition-transform duration-150 opacity-50 ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {/* Items */}
      {expanded && (
        <div className="border-t border-border">
          {messages.map((msg, i) => (
            <div
              key={msg.id}
              className={`flex items-center gap-2 px-3 py-1 text-[0.8em] group ${i > 0 ? 'border-t border-white/4' : ''}`}
            >
              <span className="text-text-dim text-[0.85em] w-4 shrink-0 text-center">{i + 1}</span>
              <span className="flex-1 min-w-0 truncate text-text-muted">
                {msg.rawInput || '(attachments)'}
              </span>

              {(msg.selectedFiles.length + msg.attachments.length) > 0 && (
                <span className="text-text-dim text-[0.78em] shrink-0">
                  {msg.selectedFiles.length + msg.attachments.length} file{(msg.selectedFiles.length + msg.attachments.length) !== 1 ? 's' : ''}
                </span>
              )}

              <button
                className="w-5 h-5 inline-flex items-center justify-center rounded bg-transparent border-none cursor-pointer text-text-faint transition-all duration-150 hover:text-accent hover:bg-white/4 opacity-0 group-hover:opacity-100"
                onClick={() => onEdit(msg.id)}
                title="Edit message"
              >
                <Pencil size={11} />
              </button>
              <button
                className="w-5 h-5 inline-flex items-center justify-center rounded bg-transparent border-none cursor-pointer text-text-faint transition-all duration-150 hover:text-accent hover:bg-white/4 opacity-0 group-hover:opacity-100"
                onClick={() => onSendNow(msg.id)}
                title="Stop AI and send now"
              >
                <CornerDownLeft size={11} />
              </button>
              <button
                className="w-5 h-5 inline-flex items-center justify-center rounded bg-transparent border-none cursor-pointer text-text-faint transition-all duration-150 hover:text-[#e74c3c] hover:bg-white/4 opacity-0 group-hover:opacity-100"
                onClick={() => onRemove(msg.id)}
                title="Remove from queue"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
