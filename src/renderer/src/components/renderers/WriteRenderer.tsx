import type { ToolCallInfo } from '../../types'

export function WriteRenderer({ tool }: { tool: ToolCallInfo }) {
  const filePath = tool.input.file_path as string | undefined
  if (!filePath) return null
  const content = tool.input.content as string || ''

  const fileName = filePath.split('/').pop() || filePath
  const lineCount = content.split('\n').length
  const preview = content.split('\n').slice(0, 5).join('\n')
  const hasMore = lineCount > 5

  return (
    <div className="border-t border-[#3a3a4a]">
      <div className="flex items-center gap-[6px] px-[10px] py-[6px] text-[#aaa] text-[0.85em]">
        <span className="text-[#4caf50] font-bold">+</span>
        <span className="font-['SF_Mono','Fira_Code',monospace] overflow-hidden text-ellipsis whitespace-nowrap" title={filePath}>{fileName}</span>
        <span className="text-[#666] ml-auto text-[0.9em]">{lineCount} lines</span>
      </div>
      {content && (
        <pre className="m-0 px-[10px] py-[6px] bg-[#0d0d1a] font-['SF_Mono','Fira_Code',monospace] text-[0.82em] leading-[1.4] whitespace-pre-wrap break-words text-[#888] border-t border-[#3a3a4a]">
          {preview}{hasMore ? '\n...' : ''}
        </pre>
      )}
    </div>
  )
}
