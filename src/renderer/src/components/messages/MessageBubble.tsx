import { memo, useMemo, useState, useCallback } from 'react'
import { ChevronDown, ChevronRight, Copy, Check } from 'lucide-react'
import { MarkdownContent } from './MarkdownContent'
import { ToolCallBlock } from './ToolCallBlock'
import { AgentCard } from './AgentCard'
import { PlanWriteRenderer } from '../renderers/PlanWriteRenderer'
import { MessageAttachmentChips } from './AttachmentChips'
import { ContextChunksRenderer } from './ContextChunksRenderer'
import type { ChatMessage, ToolCallInfo } from '../../types'
import { formatMessageContent } from '../../utils/formatMessage'

function useCopyButton(text: string | undefined) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(() => {
    if (!text) return
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [text])
  return { copied, copy }
}

function isPlanWrite(t: ToolCallInfo): boolean {
  return (t.kind === 'Edit' || t.kind === 'Write') && (t.input.file_path as string)?.includes('.claude/plans/')
}

function buildToolSummary(tools: ToolCallInfo[]): string {
  const counts: Record<string, number> = {}
  for (const t of tools) counts[t.kind] = (counts[t.kind] || 0) + 1

  const parts: string[] = []
  if (counts.Read) parts.push(`Read ${counts.Read} file${counts.Read > 1 ? 's' : ''}`)
  if (counts.Edit || counts.Write) parts.push(`edited ${(counts.Edit || 0) + (counts.Write || 0)} file${((counts.Edit || 0) + (counts.Write || 0)) > 1 ? 's' : ''}`)
  if (counts.Grep || counts.Glob) parts.push(`${(counts.Grep || 0) + (counts.Glob || 0)} search${((counts.Grep || 0) + (counts.Glob || 0)) > 1 ? 'es' : ''}`)
  if (counts.Bash) parts.push(`ran ${counts.Bash} command${counts.Bash > 1 ? 's' : ''}`)
  if (counts.WebFetch || counts.WebSearch) parts.push(`${(counts.WebFetch || 0) + (counts.WebSearch || 0)} fetch${((counts.WebFetch || 0) + (counts.WebSearch || 0)) > 1 ? 'es' : ''}`)
  if (counts.TodoWrite) parts.push('updated tasks')
  if (counts.EnterPlanMode || counts.ExitPlanMode) parts.push('plan mode')

  const excluded = new Set(['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash', 'Agent', 'TodoWrite',
    'EnterPlanMode', 'ExitPlanMode', 'AskUserQuestion', 'WebFetch', 'WebSearch'])
  for (const [kind, count] of Object.entries(counts)) {
    if (!excluded.has(kind)) {
      parts.push(`${count} ${kind}`)
    }
  }

  return parts.join(', ')
}

export const MessageBubble = memo(function MessageBubble({ message, approvedPlanToolIds }: { message: ChatMessage; approvedPlanToolIds?: Set<string> }) {
  const agents = message.toolCalls.filter((t) => t.kind === 'Agent')
  const planWrites = message.toolCalls.filter((t) => isPlanWrite(t))
  const otherTools = message.toolCalls.filter((t) => t.kind !== 'Agent' && !isPlanWrite(t))
  const hasRunning = otherTools.some((t) => t.status === 'running')
  const [groupExpanded, setGroupExpanded] = useState(hasRunning)
  const [thinkingExpanded, setThinkingExpanded] = useState(false)
  const { copied, copy } = useCopyButton(message.content)
  const isLong = message.role === 'user' && !!message.content &&
    (message.content.split('\n').length > 4 || message.content.length > 280)
  const [expanded, setExpanded] = useState(false)
  const formatted = useMemo(() => message.content ? formatMessageContent(message.content) : null, [message.content])

  // Resolve file/doc references: prefer structured data, fall back to injectedContext
  const refFiles = message.files ?? message.injectedContext?.context?.files?.map(f => f.source)
  const refDocs = message.docs ?? message.injectedContext?.context?.documentation?.names

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

  const copyBtn = message.content ? (
    <button
      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-text-dim hover:text-text-muted shrink-0"
      onClick={copy}
      aria-label="Copy message"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  ) : null

  const innerContent = (
    <>
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
      {/* File/doc reference chips */}
      {isUser && (refFiles?.length || refDocs?.length) && (
        <div className="flex flex-wrap gap-1 mb-1">
          {refDocs?.map((name, i) => (
            <span key={`doc-${i}`} className="inline-flex items-center gap-1 bg-[#3a5a44] text-[#ccc] px-2 py-0.5 rounded text-[0.78em]">
              <span title={name}>📄 {name}</span>
            </span>
          ))}
          {refFiles?.map((file, i) => (
            <span key={`file-${i}`} className="inline-flex items-center gap-1 bg-[#444460] text-[#ccc] px-2 py-0.5 rounded text-[0.78em] font-['SF_Mono','Fira_Code',monospace]">
              <span title={file}>{file.startsWith('/') ? file.split('/').pop() : file}</span>
            </span>
          ))}
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
    </>
  )

  return (
    <div className={`group ${isUser ? 'self-end max-w-[80%] flex flex-col items-end' : 'max-w-full'}`}>
      {isUser ? (
        <div className="flex flex-row items-end gap-1.5">
          {copyBtn}
          <div className="max-w-full bg-[#2a2a3d] px-3.5 py-2 rounded-[16px_16px_4px_16px] mt-2">
            {innerContent}
          </div>
        </div>
      ) : (
        <div className="max-w-full py-1">
          {innerContent}
          {copyBtn}
        </div>
      )}
      {message.injectedContext && (
        message.injectedContext.systemPrompt || message.injectedContext.developerInstructions ||
        message.injectedContext.context?.codebase?.length || message.injectedContext.context?.documentation?.names?.length || message.injectedContext.context?.files?.length
      ) && (
        <ContextChunksRenderer context={message.injectedContext} />
      )}
    </div>
  )
})
