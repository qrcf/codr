import { ToolCallBlock } from './ToolCallBlock'
import type { ChatMessage } from '../types'

export function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <div className={`message message-${message.role}`}>
      <div className="message-role">{message.role === 'user' ? 'You' : 'Claude'}</div>
      {message.content && <div className="message-content">{message.content}</div>}
      {message.toolCalls.length > 0 && (
        <div className="tool-calls">
          {message.toolCalls.map((tool) => (
            <ToolCallBlock key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </div>
  )
}
