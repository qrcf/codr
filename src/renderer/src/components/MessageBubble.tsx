import { memo, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { MarkdownContent } from './MarkdownContent'
import { ToolCallBlock } from './ToolCallBlock'
import { AgentCard } from './AgentCard'
import { PlanWriteRenderer } from './renderers/PlanWriteRenderer'
import { MessageAttachmentChips } from './AttachmentChips'
import { ContextChunksRenderer } from './ContextChunksRenderer'
import type { ChatMessage, ToolCallInfo } from '../types'
import { formatMessageContent } from '../utils/formatMessage'

function isPlanWrite(t: ToolCallInfo): boolean {
  return t.name === 'Write' && (t.input.file_path as string)?.includes('.claude/plans/')
}

function buildToolSummary(tools: ToolCallInfo[]): string {
  const counts: Record<string, number> = {}
  for (const t of tools) counts[t.name] = (counts[t.name] || 0) + 1

  const parts: string[] = []
  if (counts.Read) parts.push(`Read ${counts.Read} file${counts.Read > 1 ? 's' : ''}`)
  if (counts.Edit) parts.push(`edited ${counts.Edit} file${counts.Edit > 1 ? 's' : ''}`)
  if (counts.Write) parts.push(`wrote ${counts.Write} file${counts.Write > 1 ? 's' : ''}`)
  if (counts.Grep) parts.push(`${counts.Grep} search${counts.Grep > 1 ? 'es' : ''}`)
  if (counts.Glob) parts.push(`${counts.Glob} glob${counts.Glob > 1 ? 's' : ''}`)
  if (counts.Bash) parts.push(`ran ${counts.Bash} command${counts.Bash > 1 ? 's' : ''}`)
  if (counts.TodoWrite) parts.push('updated tasks')
  if (counts.EnterPlanMode || counts.ExitPlanMode) parts.push('plan mode')

  // Catch any remaining tool types
  const excluded = ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash', 'Agent', 'TodoWrite', 'EnterPlanMode', 'ExitPlanMode']
  for (const [name, count] of Object.entries(counts)) {
    if (!excluded.includes(name)) {
      parts.push(`${count} ${name}`)
    }
  }

  return parts.join(', ')
}

export const MessageBubble = memo(function MessageBubble({ message, approvedPlanToolIds }: { message: ChatMessage; approvedPlanToolIds?: Set<string> }) {
  const agents = message.toolCalls.filter((t) => t.name === 'Agent')
  const planWrites = message.toolCalls.filter((t) => isPlanWrite(t))
  const otherTools = message.toolCalls.filter((t) => t.name !== 'Agent' && !isPlanWrite(t))
  const hasRunning = otherTools.some((t) => t.status === 'running')
  const [groupExpanded, setGroupExpanded] = useState(hasRunning)
  const [thinkingExpanded, setThinkingExpanded] = useState(false)
  const isLong = message.role === 'user' && !!message.content &&
    (message.content.split('\n').length > 4 || message.content.length > 280)
  const [expanded, setExpanded] = useState(false)
  const formatted = useMemo(() => message.content ? formatMessageContent(message.content) : null, [message.content])

  if (message.role === 'system') {
    return (
      <div className="message-system flex items-center gap-3 px-4 py-1.5 my-3">
        <div className="flex-1 h-px bg-border-subtle" />
        <span className="text-[#555] text-[0.72em] tracking-wide whitespace-nowrap shrink-0">{message.content}</span>
        <div className="flex-1 h-px bg-border-subtle" />
      </div>
    )
  }

  const isUser = message.role === 'user'

  return (
    <div className={isUser ? 'self-end max-w-[80%] flex flex-col items-end' : 'max-w-full'}>
    <div className={`max-w-full ${isUser ? 'bg-[#2a2a3d] px-3.5 py-2 rounded-[16px_16px_4px_16px] mt-2' : 'py-1'}`}>
      {message.thinking && (
        <div className="mb-1">
          <div
            className="flex items-center gap-1.5 px-2 py-1 cursor-pointer select-none text-text-muted text-[0.85em] rounded hover:bg-border-subtle hover:text-[#ccc]"
            onClick={() => setThinkingExpanded(!thinkingExpanded)}
          >
            <span className="text-[0.8em] text-text-dim shrink-0">{thinkingExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
            <span className="font-['SF_Mono','Fira_Code',monospace]">Reasoning</span>
          </div>
          {thinkingExpanded && (
            <MarkdownContent className="thinking-content">{message.thinking}</MarkdownContent>
          )}
        </div>
      )}
      {message.content && (
        <div>
          <div
            className={`message-content${isLong && !expanded ? ' relative overflow-hidden cursor-pointer' : ''}`}
            style={isLong && !expanded ? { maxHeight: '5.5em' } : undefined}
            onClick={isLong && !expanded ? () => setExpanded(true) : undefined}
          >
            <MarkdownContent tags={formatted!.tags}>{formatted!.text}</MarkdownContent>
            {isLong && !expanded && (
              <div className="absolute bottom-0 left-0 right-0 h-8 bg-linear-to-t from-[#2a2a3d] to-transparent pointer-events-none" />
            )}
          </div>
          {isLong && expanded && (
            <button
              className="text-[0.8em] text-[#8a7faf] mt-1 hover:text-[#b0a8d0] cursor-pointer bg-transparent border-none p-0"
              onClick={() => setExpanded(false)}
            >
              Show less
            </button>
          )}
        </div>
      )}
      {message.attachments && message.attachments.length > 0 && (
        <MessageAttachmentChips attachments={message.attachments} />
      )}
      {agents.map((agent) => (
        <AgentCard key={agent.id} tool={agent} />
      ))}
      {planWrites.map((pw) => (
        <PlanWriteRenderer key={pw.id} tool={pw} isApproved={approvedPlanToolIds?.has(pw.id)} />
      ))}
      {otherTools.length > 0 && (
        <div className="mt-2">
          <div className="flex items-center gap-1.5 px-2 py-1 cursor-pointer select-none text-text-muted text-[0.85em] rounded hover:bg-border-subtle hover:text-[#ccc]" onClick={() => setGroupExpanded(!groupExpanded)}>
            <span className="text-[0.8em] text-text-dim shrink-0">{groupExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
            <span className="font-['SF_Mono','Fira_Code',monospace]">{buildToolSummary(otherTools)}</span>
          </div>
          {groupExpanded && (
            <div className="flex flex-col gap-px mt-1">
              {otherTools.map((tool) => (
                <ToolCallBlock key={tool.id} tool={tool} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
    {message.injectedContext && (
      message.injectedContext.systemPrompt || message.injectedContext.developerInstructions ||
      message.injectedContext.context?.codebase?.length || message.injectedContext.context?.documentation?.length || message.injectedContext.context?.files?.length
    ) && (
      <ContextChunksRenderer context={message.injectedContext} />
    )}
    </div>
  )
})
