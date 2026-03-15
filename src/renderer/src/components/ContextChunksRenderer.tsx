import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { InjectedContext } from '../types'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-2 last:mb-0">
      <div className="text-[0.68em] uppercase tracking-wider text-[#555] mb-1 font-['SF_Mono','Fira_Code',monospace]">{title}</div>
      {children}
    </div>
  )
}

function SourceRow({ source, right }: { source: string; right?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-[1px]">
      <span className="text-[#8a9ab0] truncate font-['SF_Mono','Fira_Code',monospace] text-[0.72em]">{source}</span>
      {right && <span className="text-[#555] shrink-0 font-['SF_Mono','Fira_Code',monospace] text-[0.68em]">{right}</span>}
    </div>
  )
}

function CollapsibleText({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-2 last:mb-0">
      <button
        className="flex items-center gap-1 text-[0.68em] uppercase tracking-wider text-[#555] hover:text-[#777] bg-transparent border-none cursor-pointer p-0 font-['SF_Mono','Fira_Code',monospace]"
        onClick={() => setOpen(!open)}
      >
        <span className="shrink-0">{open ? <ChevronDown size={9} /> : <ChevronRight size={9} />}</span>
        {label}
      </button>
      {open && (
        <pre className="mt-1 m-0 text-[0.68em] leading-normal text-[#6a7a90] whitespace-pre-wrap wrap-break-word font-['SF_Mono','Fira_Code',monospace] max-h-40 overflow-y-auto">
          {text}
        </pre>
      )}
    </div>
  )
}

export function ContextChunksRenderer({ context }: { context: InjectedContext }) {
  const [expanded, setExpanded] = useState(false)
  const { mode, systemPrompt, developerInstructions, context: ctx } = context

  const hasContent =
    mode || systemPrompt || developerInstructions ||
    ctx?.codebase?.length || ctx?.documentation?.length || ctx?.files?.length

  return (
    <div className="mt-1">
      <button
        className="flex items-center gap-[6px] px-2 py-1 bg-transparent border-none cursor-pointer select-none text-[#777] text-[0.78em] rounded hover:bg-bg-card hover:text-[#aaa] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-[#555] shrink-0">{expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</span>
        <span className="font-['SF_Mono','Fira_Code',monospace]">see context</span>
      </button>
      {expanded && (
        <div className="mt-1 border border-border-subtle rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-[#0e0e16]">
            {!hasContent && (
              <span className="text-[0.72em] text-[#555] font-['SF_Mono','Fira_Code',monospace]">no context</span>
            )}

            {mode && (
              <div className="mb-2">
                <span className="text-[0.68em] px-[6px] py-[2px] rounded bg-[#1a1a2e] text-[#8a9ab0] border border-border-subtle font-['SF_Mono','Fira_Code',monospace] uppercase tracking-wider">
                  {mode}
                </span>
              </div>
            )}

            {ctx?.codebase && ctx.codebase.length > 0 && (
              <Section title="Codebase">
                {ctx.codebase.map((item, i) => (
                  <SourceRow
                    key={i}
                    source={item.source}
                    right={item.score != null ? item.score.toFixed(1) : undefined}
                  />
                ))}
              </Section>
            )}

            {ctx?.documentation && ctx.documentation.length > 0 && (
              <Section title="Docs">
                {ctx.documentation.map((item, i) => (
                  <SourceRow
                    key={i}
                    source={item.source}
                    right={item.heading ?? undefined}
                  />
                ))}
              </Section>
            )}

            {ctx?.files && ctx.files.length > 0 && (
              <Section title="Files">
                {ctx.files.map((item, i) => (
                  <SourceRow key={i} source={item.source} />
                ))}
              </Section>
            )}

            {systemPrompt && (
              <CollapsibleText
                label="System prompt"
                text={[systemPrompt.preset, systemPrompt.append].filter(Boolean).join('\n\n')}
              />
            )}

            {developerInstructions && (
              <CollapsibleText label="Developer instructions" text={developerInstructions} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
