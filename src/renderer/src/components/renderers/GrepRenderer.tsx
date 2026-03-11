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
    <div className="grep-renderer">
      <div className="grep-header">
        <span className="grep-icon">&#128269;</span>
        <span className="grep-pattern">{pattern}</span>
        {path && <span className="grep-path">{path}</span>}
        {glob && <span className="grep-glob">{glob}</span>}
        {lines.length > 0 && <span className="grep-count">{lines.length} matches</span>}
      </div>
      {result && tool.status === 'done' && (
        <pre className="grep-results">
          {displayLines.join('\n')}{hasMore ? `\n... (${lines.length - 30} more)` : ''}
        </pre>
      )}
    </div>
  )
}
