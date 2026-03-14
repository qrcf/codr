import { useState } from 'react'
import type { ToolCallInfo } from '../../types'
import { CodeBlock } from '../CodeBlock'
import { langFromPath } from '../../utils/langUtils'

const MAX_VISIBLE_LINES = 30
const LINE_RE = /^( *\d+)([\t→])(.*)/

function parseLine(raw: string): { lineNum: number; content: string } | null {
  const m = raw.match(LINE_RE)
  if (!m) return null
  return { lineNum: parseInt(m[1].trim(), 10), content: m[3] }
}

export function ReadRenderer({ tool }: { tool: ToolCallInfo }) {
  const [showAll, setShowAll] = useState(false)
  const filePath = tool.input.file_path as string | undefined
  if (!filePath) return null
  const offset = tool.input.offset as number | undefined
  const limit = tool.input.limit as number | undefined
  const result = tool.result || ''

  const fileName = filePath.split('/').pop() || filePath
  const allLines = result.split('\n')
  const parsedLines = allLines.map(parseLine)
  const totalLines = allLines.length
  const truncated = !showAll && totalLines > MAX_VISIBLE_LINES

  const visibleParsed = truncated ? parsedLines.slice(0, MAX_VISIBLE_LINES) : parsedLines
  const codeLines = visibleParsed.map(p => (p ? p.content : ''))
  const code = codeLines.join('\n')

  const firstParsed = parsedLines.find(p => p !== null)
  const startingLineNumber = firstParsed?.lineNum ?? 1

  const rangeInfo = offset || limit
    ? ` (${offset ? `from line ${offset}` : ''}${offset && limit ? ', ' : ''}${limit ? `${limit} lines` : ''})`
    : ''

  const language = langFromPath(filePath)

  return (
    <div style={{ borderTop: '1px solid #3a3a4a' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', color: '#aaa', fontSize: '0.85em' }}>
        <span style={{ fontSize: '0.9em' }}>&#128196;</span>
        <span style={{ fontFamily: "'SF Mono', 'Fira Code', monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={filePath}>{fileName}</span>
        {rangeInfo && <span style={{ color: '#777', fontSize: '0.9em' }}>{rangeInfo}</span>}
        {tool.status === 'done' && <span style={{ color: '#666', marginLeft: 'auto', fontSize: '0.9em' }}>{totalLines} lines</span>}
      </div>
      {result && (
        <>
          <div style={{ margin: 0, background: '#0d0d1a', maxHeight: 400, overflowY: 'auto' }}>
            <CodeBlock code={code} language={language} showLineNumbers startingLineNumber={startingLineNumber} />
          </div>
          {truncated && (
            <button
              style={{ display: 'block', width: '100%', background: '#1a1a2a', border: 'none', borderTop: '1px solid #3a3a4a', color: '#8142c7', padding: '6px', fontSize: '0.82em', cursor: 'pointer', textAlign: 'center' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#222238' }}
              onMouseLeave={e => { e.currentTarget.style.background = '#1a1a2a' }}
              onClick={() => setShowAll(true)}
            >
              Show all ({totalLines} lines)
            </button>
          )}
        </>
      )}
    </div>
  )
}
