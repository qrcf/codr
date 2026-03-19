import { memo, useState, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { MarkdownContent } from '../messages/MarkdownContent'
import { MessageBubble } from '../messages/MessageBubble'
import { ToolCallBlock } from '../messages/ToolCallBlock'
import { formatMessageContent } from '../../utils/formatMessage'
import type { ChatMessage, ToolCallInfo, StreamingSegment } from '../../types'

function StreamingThinkingSection({ thinking }: { thinking: string }) {
  const [expanded, setExpanded] = useState(true)
  return (
    <div className="mb-1">
      <div
        className="flex items-center gap-1.5 px-2 py-1 cursor-pointer select-none text-text-muted text-[0.85em] rounded hover:bg-border-subtle hover:text-[#ccc]"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-[0.8em] text-text-dim shrink-0">{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
        <span className="font-['SF_Mono','Fira_Code',monospace]">Reasoning</span>
      </div>
      {expanded && (
        <MarkdownContent className="message-content streaming-thinking">{thinking}</MarkdownContent>
      )}
    </div>
  )
}

interface StreamingAreaProps {
  isLoading: boolean
  streamingText: string
  streamingTools: ToolCallInfo[]
  streamingThinking: string
  streamingSegments: StreamingSegment[]
  isCompacting: boolean
  onInterrupt: () => void
}

const StreamingArea = memo(function StreamingArea({
  isLoading,
  streamingText,
  streamingTools,
  streamingThinking,
  streamingSegments,
  isCompacting,
  onInterrupt,
}: StreamingAreaProps) {
  if (!isLoading) return null

  if (streamingSegments.length > 0) {
    return (
      <div className="py-1">
        {streamingSegments.map((segment, i) => {
          switch (segment.type) {
            case 'thinking':
              return <StreamingThinkingSection key={`thinking-${i}`} thinking={segment.content} />
            case 'tools':
              return (
                <div key={`tools-${i}`} className="flex flex-col gap-px mt-1">
                  {segment.tools.map((tool) => (
                    <ToolCallBlock key={tool.id} tool={tool} />
                  ))}
                </div>
              )
            case 'text': {
              const formatted = formatMessageContent(segment.content)
              return <MarkdownContent key={`text-${i}`} className="message-content" tags={formatted.tags}>{formatted.text}</MarkdownContent>
            }
          }
        })}
        <div className="flex items-center gap-2.5 py-2">
          <div className="w-4 h-4 border-2 border-[#444] border-t-accent rounded-full animate-[spin_0.8s_linear_infinite] shrink-0" />
          <span className="text-text-faint italic">{isCompacting ? 'Compacting context...' : streamingThinking && !streamingText && streamingTools.length === 0 ? 'Reasoning...' : 'Working...'}</span>
          <button className="ml-auto bg-transparent border border-[#555] text-[#aaa] rounded px-2.5 py-0.5 text-[0.8em] cursor-pointer hover:bg-[#f44336] hover:border-[#f44336] hover:text-white" onClick={onInterrupt}>Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div className="py-1">
      <div className="flex items-center gap-2.5 py-2">
        <div className="w-4 h-4 border-2 border-[#444] border-t-accent rounded-full animate-[spin_0.8s_linear_infinite] shrink-0" />
        <span className="text-text-faint italic">{isCompacting ? 'Compacting context...' : 'Thinking...'}</span>
        <button className="ml-auto bg-transparent border border-[#555] text-[#aaa] rounded px-2.5 py-0.5 text-[0.8em] cursor-pointer hover:bg-[#f44336] hover:border-[#f44336] hover:text-white" onClick={onInterrupt}>Cancel</button>
      </div>
    </div>
  )
})

interface MessageListProps {
  messages: ChatMessage[]
  isLoading: boolean
  streamingText: string
  streamingTools: ToolCallInfo[]
  streamingThinking: string
  streamingSegments: StreamingSegment[]
  isCompacting: boolean
  hasMoreMessages: boolean
  onInterrupt: () => void
  messagesContainerRef: React.RefObject<HTMLDivElement | null>
  messagesEndRef: React.RefObject<HTMLDivElement | null>
  approvedPlanToolIds?: Set<string>
  shouldAutoScrollRef: React.MutableRefObject<boolean>
}

const NEAR_BOTTOM_THRESHOLD = 80

export function MessageList({
  messages,
  isLoading,
  streamingText,
  streamingTools,
  streamingThinking,
  streamingSegments,
  isCompacting,
  hasMoreMessages,
  onInterrupt,
  messagesContainerRef,
  messagesEndRef,
  approvedPlanToolIds,
  shouldAutoScrollRef,
}: MessageListProps) {
  const [showScrollButton, setShowScrollButton] = useState(false)

  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return
    const onScroll = () => {
      const isNearBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight < NEAR_BOTTOM_THRESHOLD
      setShowScrollButton(!isNearBottom)
      shouldAutoScrollRef.current = isNearBottom
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [messagesContainerRef, shouldAutoScrollRef])

  const handleScrollToBottom = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
    setShowScrollButton(false)
    shouldAutoScrollRef.current = true
  }, [messagesContainerRef, shouldAutoScrollRef])

  return (
    <div className="relative h-full overflow-hidden">
    <div className="h-full overflow-y-auto px-6 py-4 flex flex-col gap-1 max-w-205 w-full mx-auto max-[768px]:max-w-full max-[768px]:px-3 max-[768px]:py-3 scroll-auto-hide" ref={messagesContainerRef}>
      {hasMoreMessages && (
        <div className="text-center p-2 text-text-faint text-[0.85rem]">Loading earlier messages...</div>
      )}
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} approvedPlanToolIds={approvedPlanToolIds} />
      ))}

      <StreamingArea
        isLoading={isLoading}
        streamingText={streamingText}
        streamingTools={streamingTools}
        streamingThinking={streamingThinking}
        streamingSegments={streamingSegments}
        isCompacting={isCompacting}
        onInterrupt={onInterrupt}
      />

      <div ref={messagesEndRef} />
    </div>
    {showScrollButton && (
      <button
        className="absolute bottom-5 right-5 w-8 h-8 rounded-full bg-[#1e1e1e] border border-[#444] text-[#aaa] flex items-center justify-center shadow-lg hover:bg-[#2a2a2a] hover:text-white cursor-pointer z-10"
        onClick={handleScrollToBottom}
        aria-label="Scroll to bottom"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M2.5 5L7 9.5L11.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    )}
    </div>
  )
}
