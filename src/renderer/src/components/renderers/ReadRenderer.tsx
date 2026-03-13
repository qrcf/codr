import { useState } from 'react'
import type { ToolCallInfo } from '../../types'

const MAX_VISIBLE_LINES = 30

export function ReadRenderer({ tool }: { tool: ToolCallInfo }) {
  const [showAll, setShowAll] = useState(false)
  const filePath = tool.input.file_path as string | undefined
  if (!filePath) return null
  const offset = tool.input.offset as number | undefined
  const limit = tool.input.limit as number | undefined
  const result = tool.result || ''

  const fileName = filePath.split('/').pop() || filePath
  const lines = result.split('\n')
  const totalLines = lines.length
  const truncated = !showAll && totalLines > MAX_VISIBLE_LINES
  const visibleContent = truncated ? lines.slice(0, MAX_VISIBLE_LINES).join('\n') : result

  const rangeInfo = offset || limit
    ? ` (${offset ? `from line ${offset}` : ''}${offset && limit ? ', ' : ''}${limit ? `${limit} lines` : ''})`
    : ''

  return (
    <div className="border-t border-[#3a3a4a]">
      <div className="flex items-center gap-[6px] px-[10px] py-[6px] text-[#aaa] text-[0.85em]">
        <span className="text-[0.9em]">&#128196;</span>
        <span className="font-['SF_Mono','Fira_Code',monospace] overflow-hidden text-ellipsis whitespace-nowrap" title={filePath}>{fileName}</span>
        {rangeInfo && <span className="text-[#777] text-[0.9em]">{rangeInfo}</span>}
        {tool.status === 'done' && <span className="text-[#666] ml-auto text-[0.9em]">{totalLines} lines</span>}
      </div>
      {result && (
        <>
          <pre className="m-0 px-[10px] py-2 bg-[#0d0d1a] font-['SF_Mono','Fira_Code',monospace] text-[0.82em] leading-[1.4] whitespace-pre-wrap break-words text-[#b8b8b8] max-h-[400px] overflow-y-auto">{visibleContent}</pre>
          {truncated && (
            <button
              className="block w-full bg-[#1a1a2a] border-0 border-t border-[#3a3a4a] text-[#8142c7] py-[6px] text-[0.82em] cursor-pointer text-center hover:bg-[#222238]"
              onClick={() => setShowAll(true)}
            >
              Show all ({totalLines} lines)
            </button>
          )}
        </>
      )}
    </div>
  )
}
