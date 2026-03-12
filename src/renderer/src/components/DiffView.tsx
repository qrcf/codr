import { diffLines } from 'diff'

interface DiffViewProps {
  oldString: string
  newString: string
  maxLines?: number
}

export function DiffView({ oldString, newString, maxLines = 50 }: DiffViewProps) {
  const changes = diffLines(oldString, newString)

  const lines: { type: 'added' | 'removed' | 'context'; text: string }[] = []
  for (const change of changes) {
    const type = change.added ? 'added' : change.removed ? 'removed' : 'context'
    const raw = change.value.endsWith('\n') ? change.value.slice(0, -1) : change.value
    for (const line of raw.split('\n')) {
      lines.push({ type, text: line })
    }
  }

  const truncated = lines.length > maxLines
  const visible = truncated ? lines.slice(0, maxLines) : lines

  return (
    <div className="diff-view">
      {visible.map((line, i) => (
        <div key={i} className={`diff-line diff-line-${line.type}`}>
          <span className="diff-marker">
            {line.type === 'removed' ? '-' : line.type === 'added' ? '+' : ' '}
          </span>
          <span className="diff-content">{line.text}</span>
        </div>
      ))}
      {truncated && (
        <div className="diff-truncated">... {lines.length - maxLines} more lines</div>
      )}
    </div>
  )
}
