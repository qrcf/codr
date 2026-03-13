import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MessageBubble } from './MessageBubble'
import { ToolCallBlock } from './ToolCallBlock'
import { formatMessageContent } from '../utils/formatMessage'
import type { ChatMessage, ToolCallInfo } from '../types'

interface MessageListProps {
  messages: ChatMessage[]
  isLoading: boolean
  streamingText: string
  streamingTools: ToolCallInfo[]
  streamingThinking: string
  isCompacting: boolean
  hasMoreMessages: boolean
  onInterrupt: () => void
  messagesContainerRef: React.RefObject<HTMLDivElement | null>
  messagesEndRef: React.RefObject<HTMLDivElement | null>
}

export function MessageList({
  messages,
  isLoading,
  streamingText,
  streamingTools,
  streamingThinking,
  isCompacting,
  hasMoreMessages,
  onInterrupt,
  messagesContainerRef,
  messagesEndRef,
}: MessageListProps) {
  return (
    <div className="flex-1 overflow-y-auto min-h-0 px-6 py-4 flex flex-col gap-1 max-w-[820px] w-full mx-auto max-[768px]:max-w-full max-[768px]:px-3 max-[768px]:py-3" ref={messagesContainerRef}>
      {hasMoreMessages && (
        <div className="text-center p-2 text-[#888] text-[0.85rem]">Loading earlier messages...</div>
      )}
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}

      {isLoading && (streamingText || streamingTools.length > 0) && (
        <div className="py-1">
          {streamingText && <div className="message-content"><Markdown remarkPlugins={[remarkGfm]}>{formatMessageContent(streamingText)}</Markdown></div>}
          {streamingTools.length > 0 && (
            <div className="flex flex-col gap-[1px] mt-1">
              {streamingTools.map((tool) => (
                <ToolCallBlock key={tool.id} tool={tool} />
              ))}
            </div>
          )}
          <div className="flex items-center gap-[10px] py-2">
            <div className="w-4 h-4 border-2 border-[#444] border-t-[#8142c7] rounded-full animate-[spin_0.8s_linear_infinite] flex-shrink-0" />
            <span className="text-[#888] italic">Working...</span>
            <button className="ml-auto bg-transparent border border-[#555] text-[#aaa] rounded px-[10px] py-[2px] text-[0.8em] cursor-pointer hover:bg-[#f44336] hover:border-[#f44336] hover:text-white" onClick={onInterrupt}>Cancel</button>
          </div>
        </div>
      )}

      {isLoading && !streamingText && streamingTools.length === 0 && (
        <div className="py-1">
          {streamingThinking && (
            <div className="message-content streaming-thinking">
              <Markdown remarkPlugins={[remarkGfm]}>{streamingThinking}</Markdown>
            </div>
          )}
          <div className="flex items-center gap-[10px] py-2">
            <div className="w-4 h-4 border-2 border-[#444] border-t-[#8142c7] rounded-full animate-[spin_0.8s_linear_infinite] flex-shrink-0" />
            <span className="text-[#888] italic">{isCompacting ? 'Compacting context...' : streamingThinking ? 'Reasoning...' : 'Thinking...'}</span>
            <button className="ml-auto bg-transparent border border-[#555] text-[#aaa] rounded px-[10px] py-[2px] text-[0.8em] cursor-pointer hover:bg-[#f44336] hover:border-[#f44336] hover:text-white" onClick={onInterrupt}>Cancel</button>
          </div>
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  )
}
