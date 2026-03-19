import { DiffView } from '../ui/DiffView'
import type { ToolCallInfo } from '../../types'

export function EditRenderer({ tool }: { tool: ToolCallInfo }) {
  const filePath = (tool.input.file_path as string) || tool.locations?.[0]?.path || ''
  const oldString = tool.input.old_string as string || ''
  const newString = tool.input.new_string as string || ''
  const replaceAll = tool.input.replace_all as boolean

  const fileName = filePath ? (filePath.split('/').pop() || filePath) : (tool.title || 'Edit')

  return (
    <div className="border-t border-[#3a3a4a]">
      <div className="flex items-center gap-[6px] px-[10px] py-[6px] text-[#aaa] text-[0.85em]">
        <span className="text-[#f0c040] font-bold">~</span>
        <span className="font-['SF_Mono','Fira_Code',monospace] overflow-hidden text-ellipsis whitespace-nowrap" title={filePath}>{fileName}</span>
        {replaceAll && <span className="bg-[#444460] text-[#ccc] px-[6px] py-[1px] rounded-[3px] text-[0.85em] ml-auto">replace all</span>}
      </div>
      {(oldString || newString) ? (
        <DiffView oldString={oldString} newString={newString} />
      ) : tool.result ? (
        <pre style={{ margin: 0, padding: '8px 10px', background: '#0d0d1a', fontFamily: "'SF Mono', 'Fira Code', monospace", fontSize: '0.82em', lineHeight: 1.4, whiteSpace: 'pre-wrap', wordWrap: 'break-word', color: '#b0b0b0', maxHeight: 300, overflowY: 'auto', borderTop: '1px solid #3a3a4a' }}>
          {tool.result.length > 2000 ? tool.result.slice(0, 2000) + '\n...' : tool.result}
        </pre>
      ) : null}
    </div>
  )
}
