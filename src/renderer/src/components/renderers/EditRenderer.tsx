import type { ToolCallInfo } from '../../types'

export function EditRenderer({ tool }: { tool: ToolCallInfo }) {
  const filePath = tool.input.file_path as string || ''
  const oldString = tool.input.old_string as string || ''
  const newString = tool.input.new_string as string || ''
  const replaceAll = tool.input.replace_all as boolean

  const fileName = filePath.split('/').pop() || filePath

  return (
    <div className="edit-renderer">
      <div className="edit-file-header">
        <span className="edit-file-icon">~</span>
        <span className="edit-file-name" title={filePath}>{fileName}</span>
        {replaceAll && <span className="edit-replace-all-badge">replace all</span>}
      </div>
      <div className="edit-diff">
        {oldString && (
          <pre className="edit-diff-old">
            <span className="edit-diff-marker">-</span>
            {oldString.length > 500 ? oldString.slice(0, 500) + '...' : oldString}
          </pre>
        )}
        {newString && (
          <pre className="edit-diff-new">
            <span className="edit-diff-marker">+</span>
            {newString.length > 500 ? newString.slice(0, 500) + '...' : newString}
          </pre>
        )}
      </div>
    </div>
  )
}
