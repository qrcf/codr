import type { ToolCallInfo } from '../../types'

export function GrepRenderer({ tool }: { tool: ToolCallInfo }) {
  const pattern = tool.input.pattern as string || ''
  const path = tool.input.path as string | undefined
  const glob = tool.input.glob as string | undefined
  const result = tool.result || ''

  const lines = result.split('\n').filter(Boolean)
  const displayLines = lines.slice(0, 30)
  const hasMore = lines.length > 30

  return (
    <div className="border-t border-[#3a3a4a]">
      <div className="flex items-center gap-[6px] px-[10px] py-[6px] text-[#aaa] text-[0.85em]">
        <span className="text-[0.9em]">&#128269;</span>
        <span className="font-['SF_Mono','Fira_Code',monospace] text-[#c3e88d] overflow-hidden text-ellipsis whitespace-nowrap">{pattern}</span>
        {path && <span className="text-[#777] font-['SF_Mono','Fira_Code',monospace] text-[0.9em]">{path}</span>}
        {glob && <span className="text-[#777] font-['SF_Mono','Fira_Code',monospace] text-[0.9em]">{glob}</span>}
        {lines.length > 0 && <span className="text-[#666] ml-auto text-[0.9em]">{lines.length} matches</span>}
      </div>
      {result && tool.status === 'done' && (
        <pre className="m-0 px-[10px] py-2 bg-[#0d0d1a] font-['SF_Mono','Fira_Code',monospace] text-[0.82em] leading-[1.4] whitespace-pre-wrap break-words text-[#b0b0b0] max-h-[300px] overflow-y-auto border-t border-[#3a3a4a]">
          {displayLines.join('\n')}{hasMore ? `\n... (${lines.length - 30} more)` : ''}
        </pre>
      )}
    </div>
  )
}
