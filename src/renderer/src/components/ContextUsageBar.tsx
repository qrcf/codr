import { Activity } from 'lucide-react'

function getBarColor(pct: number): string {
  if (pct < 0.5) return '#4ade80'   // green
  if (pct < 0.75) return '#facc15'  // yellow
  if (pct < 0.9) return '#fb923c'   // orange
  return '#ef4444'                   // red
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

export function ContextUsageBar({
  inputTokens,
  outputTokens,
  cacheReadInputTokens,
  cacheCreationInputTokens,
  contextWindow,
}: TokenUsage) {
  const totalContext = inputTokens + cacheReadInputTokens + cacheCreationInputTokens
  const pct = Math.min(totalContext / contextWindow, 1)
  const color = getBarColor(pct)

  return (
    <div className="context-usage-bar" title="">
      <div className="context-usage-inner">
        <Activity size={11} style={{ opacity: 0.5, flexShrink: 0 }} />
        <div className="context-usage-track">
          <div
            className="context-usage-fill"
            style={{ width: `${pct * 100}%`, backgroundColor: color }}
          />
        </div>
        <span className="context-usage-label">
          {formatTokens(totalContext)} / {formatTokens(contextWindow)}
        </span>
      </div>
      <div className="context-usage-tooltip">
        <div className="context-usage-tooltip-row">
          <span>Input tokens</span>
          <span>{inputTokens.toLocaleString()}</span>
        </div>
        <div className="context-usage-tooltip-row">
          <span>Cache read</span>
          <span>{cacheReadInputTokens.toLocaleString()}</span>
        </div>
        <div className="context-usage-tooltip-row">
          <span>Cache creation</span>
          <span>{cacheCreationInputTokens.toLocaleString()}</span>
        </div>
        <div className="context-usage-tooltip-row" style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 4, marginTop: 2 }}>
          <span>Total context</span>
          <span>{totalContext.toLocaleString()}</span>
        </div>
        <div className="context-usage-tooltip-row">
          <span>Output tokens</span>
          <span>{outputTokens.toLocaleString()}</span>
        </div>
        <div className="context-usage-tooltip-row">
          <span>Context window</span>
          <span>{contextWindow.toLocaleString()}</span>
        </div>
      </div>
    </div>
  )
}
