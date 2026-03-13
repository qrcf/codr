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
    <div className="font-['SF_Mono','Fira_Code',monospace] text-[0.85em] overflow-x-auto">
      {visible.map((line, i) => (
        <div
          key={i}
          className={`flex leading-[1.5] px-[10px] min-h-[1.5em] ${line.type === 'removed' ? 'bg-[rgba(244,67,54,0.1)]' : line.type === 'added' ? 'bg-[rgba(76,175,80,0.1)]' : ''}`}
        >
          <span className={`w-4 flex-shrink-0 select-none text-center ${line.type === 'removed' ? 'text-[#f44336]' : line.type === 'added' ? 'text-[#4caf50]' : 'text-[#888]'}`}>
            {line.type === 'removed' ? '-' : line.type === 'added' ? '+' : ' '}
          </span>
          <span className="whitespace-pre-wrap break-words flex-1">{line.text}</span>
        </div>
      ))}
      {truncated && (
        <div className="px-[10px] py-1 text-[#888] text-[0.85em] italic">
          ... {lines.length - maxLines} more lines
        </div>
      )}
    </div>
  )
}
