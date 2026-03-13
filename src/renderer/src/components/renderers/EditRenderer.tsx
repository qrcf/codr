import { DiffView } from '../DiffView'
import type { ToolCallInfo } from '../../types'

export function EditRenderer({ tool }: { tool: ToolCallInfo }) {
  const filePath = tool.input.file_path as string | undefined
  if (!filePath) return null
  const oldString = tool.input.old_string as string || ''
  const newString = tool.input.new_string as string || ''
  const replaceAll = tool.input.replace_all as boolean

  const fileName = filePath.split('/').pop() || filePath

  return (
    <div className="border-t border-[#3a3a4a]">
      <div className="flex items-center gap-[6px] px-[10px] py-[6px] text-[#aaa] text-[0.85em]">
        <span className="text-[#f0c040] font-bold">~</span>
        <span className="font-['SF_Mono','Fira_Code',monospace] overflow-hidden text-ellipsis whitespace-nowrap" title={filePath}>{fileName}</span>
        {replaceAll && <span className="bg-[#444460] text-[#ccc] px-[6px] py-[1px] rounded-[3px] text-[0.85em] ml-auto">replace all</span>}
      </div>
      <DiffView oldString={oldString} newString={newString} />
    </div>
  )
}
