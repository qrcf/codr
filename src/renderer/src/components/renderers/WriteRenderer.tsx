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
    <div className="write-renderer">
      <div className="write-file-header">
        <span className="write-file-icon">+</span>
        <span className="write-file-name" title={filePath}>{fileName}</span>
        <span className="write-line-count">{lineCount} lines</span>
      </div>
      {content && (
        <pre className="write-preview">
          {preview}{hasMore ? '\n...' : ''}
        </pre>
      )}
    </div>
  )
}
