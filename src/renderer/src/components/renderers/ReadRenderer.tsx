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
    <div className="read-renderer">
      <div className="read-file-header">
        <span className="read-file-icon">&#128196;</span>
        <span className="read-file-name" title={filePath}>{fileName}</span>
        {rangeInfo && <span className="read-range">{rangeInfo}</span>}
        {tool.status === 'done' && <span className="read-line-count">{totalLines} lines</span>}
      </div>
      {result && (
        <>
          <pre className="read-content">{visibleContent}</pre>
          {truncated && (
            <button className="read-show-more" onClick={() => setShowAll(true)}>
              Show all ({totalLines} lines)
            </button>
          )}
        </>
      )}
    </div>
  )
}
