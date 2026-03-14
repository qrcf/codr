import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ToolCallInfo } from '../../types'

export function BashRenderer({ tool }: { tool: ToolCallInfo }) {
  const [outputExpanded, setOutputExpanded] = useState(false)
  const command = tool.input.command as string | undefined
  if (!command) return null
  const description = tool.input.description as string | undefined
  const result = tool.result || ''

  return (
    <div className="border-t border-[#3a3a4a] font-['SF_Mono','Fira_Code',monospace] text-[0.85em]">
      {description && <div className="px-[10px] pt-[6px] text-[#777] text-[0.9em] font-[system-ui,-apple-system,sans-serif]">{description}</div>}
      <div className="flex gap-2 px-[10px] py-[6px] text-[#e0e0e0] leading-[1.4]">
        <span className="text-[#4caf50] flex-shrink-0 select-none">$</span>
        <span className="whitespace-pre-wrap break-all">{command}</span>
      </div>
      {result && (
        <>
          <div
            className="px-[10px] py-1 text-[#888] text-[0.8em] cursor-pointer select-none border-t border-[#3a3a4a] hover:text-[#ccc] hover:bg-[#1a1a2a]"
            onClick={() => setOutputExpanded(!outputExpanded)}
          >
            <span className="mr-1 text-[0.75em]">{outputExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
            {outputExpanded ? 'Hide output' : 'Show output'}
          </div>
          {outputExpanded && (
            <pre style={{ margin: 0, padding: '8px 10px', background: '#0d0d1a', fontFamily: "'SF Mono', 'Fira Code', monospace", fontSize: '0.82em', lineHeight: 1.4, whiteSpace: 'pre-wrap', wordWrap: 'break-word', color: tool.isError ? '#f44336' : '#b8b8b8', maxHeight: 300, overflowY: 'auto', borderTop: '1px solid #3a3a4a' }}>
              {result.length > 2000 ? result.slice(0, 2000) + '\n...' : result}
            </pre>
          )}
        </>
      )}
    </div>
  )
}
