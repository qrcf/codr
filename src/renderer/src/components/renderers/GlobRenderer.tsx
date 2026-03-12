import type { ToolCallInfo } from '../../types'

export function GlobRenderer({ tool }: { tool: ToolCallInfo }) {
  const pattern = tool.input.pattern as string || ''
  const result = tool.result || ''

  const files = result.split('\n').filter(Boolean)
  const displayFiles = files.slice(0, 20)
  const hasMore = files.length > 20

  return (
    <div className="glob-renderer">
      <div className="glob-header">
        <span className="glob-icon">&#128193;</span>
        <span className="glob-pattern">{pattern}</span>
        {files.length > 0 && <span className="glob-count">{files.length} files</span>}
      </div>
      {files.length > 0 && tool.status === 'done' && (
        <div className="glob-file-list">
          {displayFiles.map((f, i) => (
            <div key={i} className="glob-file-item">{f.split('/').pop()}</div>
          ))}
          {hasMore && <div className="glob-file-more">... {files.length - 20} more</div>}
        </div>
      )}
    </div>
  )
}
