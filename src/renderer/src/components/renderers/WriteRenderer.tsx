import type { ToolCallInfo } from '../../types'
import { CodeBlock } from '../messages/CodeBlock'
import { langFromPath } from '../../utils/langUtils'

const PREVIEW_LINES = 8

export function WriteRenderer({ tool }: { tool: ToolCallInfo }) {
  const filePath = tool.input.file_path as string | undefined
  if (!filePath) return null
  const content = tool.input.content as string || ''

  const fileName = filePath.split('/').pop() || filePath
  const lines = content.split('\n')
  const lineCount = lines.length
  const preview = lines.slice(0, PREVIEW_LINES).join('\n')
  const hasMore = lineCount > PREVIEW_LINES
  const language = langFromPath(filePath)

  return (
    <div className="border-t border-[#3a3a4a]">
      <div className="flex items-center gap-[6px] px-[10px] py-[6px] text-[#aaa] text-[0.85em]">
        <span className="text-[#4caf50] font-bold">+</span>
        <span className="font-['SF_Mono','Fira_Code',monospace] overflow-hidden text-ellipsis whitespace-nowrap" title={filePath}>{fileName}</span>
        <span className="text-[#666] ml-auto text-[0.9em]">{lineCount} lines</span>
      </div>
      {content && (
        <div style={{ borderTop: '1px solid #3a3a4a', background: '#0d0d1a' }}>
          <CodeBlock code={preview} language={language} />
          {hasMore && (
            <div style={{ padding: '2px 12px 6px', color: '#555', fontSize: '0.82em', fontFamily: "'SF Mono', 'Fira Code', monospace" }}>
              ...
            </div>
          )}
        </div>
      )}
    </div>
  )
}
