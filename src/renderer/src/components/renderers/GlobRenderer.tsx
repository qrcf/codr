import type { ToolCallInfo } from '../../types'

export function GlobRenderer({ tool }: { tool: ToolCallInfo }) {
  const pattern = tool.input.pattern as string || ''
  const result = tool.result || ''

  const files = result.split('\n').filter(Boolean)
  const displayFiles = files.slice(0, 20)
  const hasMore = files.length > 20

  return (
    <div className="border-t border-[#3a3a4a]">
      <div className="flex items-center gap-[6px] px-[10px] py-[6px] text-[#aaa] text-[0.85em]">
        <span className="text-[0.9em]">&#128193;</span>
        <span className="font-['SF_Mono','Fira_Code',monospace] text-[#82aaff]">{pattern}</span>
        {files.length > 0 && <span className="text-[#666] ml-auto text-[0.9em]">{files.length} files</span>}
      </div>
      {files.length > 0 && tool.status === 'done' && (
        <div className="px-[10px] pb-2 flex flex-col gap-[1px]">
          {displayFiles.map((f, i) => (
            <div key={i} className="font-['SF_Mono','Fira_Code',monospace] text-[0.82em] text-[#b0b0b0] px-[6px] py-[2px]">{f.split('/').pop()}</div>
          ))}
          {hasMore && <div className="text-[0.82em] text-[#666] px-[6px] py-[2px]">... {files.length - 20} more</div>}
        </div>
      )}
    </div>
  )
}
