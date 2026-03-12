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
    <div className="bash-renderer">
      {description && <div className="bash-description">{description}</div>}
      <div className="bash-command">
        <span className="bash-prompt">$</span>
        <span className="bash-cmd-text">{command}</span>
      </div>
      {result && (
        <>
          <div className="bash-output-toggle" onClick={() => setOutputExpanded(!outputExpanded)}>
            <span className="bash-toggle-chevron">{outputExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
            {outputExpanded ? 'Hide output' : 'Show output'}
          </div>
          {outputExpanded && (
            <pre className={`bash-output ${tool.isError ? 'bash-output-error' : ''}`}>
              {result.length > 2000 ? result.slice(0, 2000) + '\n...' : result}
            </pre>
          )}
        </>
      )}
    </div>
  )
}
