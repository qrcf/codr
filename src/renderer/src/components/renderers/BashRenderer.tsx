import type { ToolCallInfo } from '../../types'

export function BashRenderer({ tool }: { tool: ToolCallInfo }) {
  const command = tool.input.command as string || ''
  const description = tool.input.description as string | undefined
  const result = tool.result || ''

  return (
    <div className="bash-renderer">
      {description && <div className="bash-description">{description}</div>}
      <div className="bash-command">
        <span className="bash-prompt">$</span>
        <span className="bash-cmd-text">{command}</span>
      </div>
      {result && (
        <pre className={`bash-output ${tool.isError ? 'bash-output-error' : ''}`}>
          {result.length > 2000 ? result.slice(0, 2000) + '\n...' : result}
        </pre>
      )}
    </div>
  )
}
