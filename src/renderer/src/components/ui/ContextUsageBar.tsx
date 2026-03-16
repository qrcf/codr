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
  subagentInputTokens,
  subagentOutputTokens,
}: TokenUsage) {
  const totalContext = inputTokens + cacheReadInputTokens + cacheCreationInputTokens
  const pct = Math.min(totalContext / contextWindow, 1)
  const color = getBarColor(pct)
  const hasSubagent = (subagentInputTokens || 0) + (subagentOutputTokens || 0) > 0
  const totalAllTokens = totalContext + outputTokens + (subagentInputTokens || 0) + (subagentOutputTokens || 0)

  return (
    <div className="group relative inline-flex items-center" title="">
      <div className="inline-flex items-center gap-1.25 cursor-default">
        <Activity size={11} style={{ opacity: 0.5, flexShrink: 0 }} />
        <div className="w-20 h-1 bg-white/8 rounded-xs overflow-hidden">
          <div
            className="h-full rounded-xs transition-[width,background-color] duration-400"
            style={{ width: `${pct * 100}%`, backgroundColor: color }}
          />
        </div>
        <span className="text-[0.65rem] text-text-faint whitespace-nowrap tracking-tight">
          {formatTokens(totalContext)} / {formatTokens(contextWindow)}
        </span>
      </div>
      <div className="hidden group-hover:block absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 bg-bg-card border border-white/10 rounded-lg px-3 py-2 text-[0.7rem] text-[#ccc] whitespace-nowrap z-100 min-w-45 shadow-[0_4px_12px_rgba(0,0,0,0.3)]">
        <div className="flex justify-between gap-4 py-0.5">
          <span>Input tokens</span>
          <span className="context-usage-tooltip-row">{inputTokens.toLocaleString()}</span>
        </div>
        <div className="flex justify-between gap-4 py-0.5">
          <span>Cache read</span>
          <span className="context-usage-tooltip-row">{cacheReadInputTokens.toLocaleString()}</span>
        </div>
        <div className="flex justify-between gap-4 py-0.5">
          <span>Cache creation</span>
          <span className="context-usage-tooltip-row">{cacheCreationInputTokens.toLocaleString()}</span>
        </div>
        <div className="flex justify-between gap-4 py-1 mt-0.5 border-t border-white/10">
          <span>Total context</span>
          <span className="context-usage-tooltip-row">{totalContext.toLocaleString()}</span>
        </div>
        <div className="flex justify-between gap-4 py-0.5">
          <span>Output tokens</span>
          <span className="context-usage-tooltip-row">{outputTokens.toLocaleString()}</span>
        </div>
        <div className="flex justify-between gap-4 py-0.5">
          <span>Context window</span>
          <span className="context-usage-tooltip-row">{contextWindow.toLocaleString()}</span>
        </div>
        {hasSubagent && (
          <>
            <div className="flex justify-between gap-4 py-1 mt-0.5 border-t border-white/10">
              <span>Subagent tokens</span>
              <span className="context-usage-tooltip-row">{((subagentInputTokens || 0) + (subagentOutputTokens || 0)).toLocaleString()}</span>
            </div>
            <div className="flex justify-between gap-4 py-0.5">
              <span>Total all tokens</span>
              <span className="context-usage-tooltip-row">{totalAllTokens.toLocaleString()}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
