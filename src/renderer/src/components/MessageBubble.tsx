import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ToolCallBlock } from './ToolCallBlock'
import { AgentCard } from './AgentCard'
import { PlanWriteRenderer } from './renderers/PlanWriteRenderer'
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

export function MessageBubble({ message }: { message: ChatMessage }) {
  const agents = message.toolCalls.filter((t) => t.name === 'Agent')
  const planWrites = message.toolCalls.filter((t) => isPlanWrite(t))
  const otherTools = message.toolCalls.filter((t) => t.name !== 'Agent' && !isPlanWrite(t))
  const hasRunning = otherTools.some((t) => t.status === 'running')
  const [groupExpanded, setGroupExpanded] = useState(hasRunning)

  if (message.role === 'system') {
    return (
      <div className="message message-system">
        <span className="system-label">{message.content}</span>
      </div>
    )
  }

  return (
    <div className={`message message-${message.role}`}>
      {message.content && (
        <div className="message-content">
          <Markdown remarkPlugins={[remarkGfm]}>{formatMessageContent(message.content)}</Markdown>
        </div>
      )}
      {agents.map((agent) => (
        <AgentCard key={agent.id} tool={agent} />
      ))}
      {planWrites.map((pw) => (
        <PlanWriteRenderer key={pw.id} tool={pw} />
      ))}
      {otherTools.length > 0 && (
        <div className="tool-calls-group">
          <div className="tool-group-header" onClick={() => setGroupExpanded(!groupExpanded)}>
            <span className="tool-group-chevron">{groupExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
            <span className="tool-group-summary">{buildToolSummary(otherTools)}</span>
          </div>
          {groupExpanded && (
            <div className="tool-calls">
              {otherTools.map((tool) => (
                <ToolCallBlock key={tool.id} tool={tool} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
