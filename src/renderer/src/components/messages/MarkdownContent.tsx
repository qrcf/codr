import React, { useMemo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { extractXmlTags, escapeXmlTags, type ExtractedTag } from '../../utils/formatMessage'
import { CodeBlock } from './CodeBlock'
import { normalizeLang } from '../../utils/langUtils'

const REMARK_PLUGINS = [remarkGfm]

const FILE_REF_RE = /^@(?:(?:[a-zA-Z0-9_-]+\/)+[a-zA-Z0-9_./-]*|[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9]{1,10})+)$/

const MD_COMPONENTS = {
  code: ({ children, className }: { children?: React.ReactNode; className?: string }) => {
    const text = String(children)
    // File reference pill (inline, no language class)
    if (!className && FILE_REF_RE.test(text)) {
      return (
        <span className="inline-flex items-center bg-[#444460] text-[#c4b5fd] px-1.25 py-px rounded text-[0.82em] font-['SF_Mono','Fira_Code',monospace] whitespace-nowrap">
          {text}
        </span>
      )
    }
    // Fenced code block — has className like "language-tsx" or contains newlines
    if (className?.startsWith('language-') || text.includes('\n')) {
      const lang = className?.startsWith('language-') ? normalizeLang(className.slice('language-'.length)) : 'text'
      return (
        <div style={{ background: '#0d0d1a', border: '1px solid #2a2a3a', borderRadius: 6, overflow: 'hidden', margin: '6px 0' }}>
          <CodeBlock code={text.replace(/\n$/, '')} language={lang} />
        </div>
      )
    }
    return <code className={className}>{children}</code>
  },
}

/** Keys whose numeric values represent durations in milliseconds */
const DURATION_KEYS = new Set(['duration_ms', 'duration', 'elapsed_ms', 'elapsed', 'time_ms', 'latency_ms', 'latency'])

/** Formats a tag's key:value content into human-readable label pairs */
function formatTagEntries(content: string): { key: string; value: string }[] {
  return content.split(/\s+/).reduce<{ key: string; value: string }[]>((acc, token) => {
    if (token.includes(':')) {
      const idx = token.indexOf(':')
      acc.push({ key: token.slice(0, idx), value: token.slice(idx + 1) })
    } else if (acc.length > 0) {
      // Append to previous value (handles multi-word values)
      acc[acc.length - 1].value += ' ' + token
    } else {
      acc.push({ key: '', value: token })
    }
    return acc
  }, [])
}

function formatTagValue(key: string, val: string): string {
  const num = Number(val)
  if (isNaN(num)) return val
  // Format durations — only when the key explicitly indicates milliseconds
  if (DURATION_KEYS.has(key) && num > 0) return `${(num / 1000).toFixed(1)}s`
  // Format large numbers with commas
  if (num > 999) return num.toLocaleString()
  return val
}

function TagPill({ tag }: { tag: ExtractedTag }) {
  const entries = formatTagEntries(tag.content)
  if (entries.length === 0) return null

  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <span className="text-text-dim text-[0.7em] font-['SF_Mono','Fira_Code',monospace] uppercase tracking-wider">{tag.tag}</span>
      {entries.map((e, i) => (
        <span key={i} className="inline-flex items-center gap-0.75 bg-border-subtle rounded px-1.5 py-px text-[0.75em] font-['SF_Mono','Fira_Code',monospace]">
          {e.key && <span className="text-[#777]">{e.key}</span>}
          {e.key && <span className="text-[#555]">:</span>}
          <span className="text-text-muted">{formatTagValue(e.key, e.value)}</span>
        </span>
      ))}
    </span>
  )
}

interface MarkdownContentProps {
  /** Raw content string — XML tags will be extracted and rendered as metadata */
  children: string
  /** Pre-parsed tags (from formatMessageContent). If provided, children is treated as already cleaned. */
  tags?: ExtractedTag[]
  /** Additional className on the outer wrapper */
  className?: string
}

/**
 * Renders markdown content with XML-like metadata tags extracted and displayed
 * as styled pills/chips below the main text. Replaces raw <Markdown> usage.
 */
export function MarkdownContent({ children, tags: preParsedTags, className }: MarkdownContentProps) {
  const { text, tags } = useMemo(() => {
    if (preParsedTags) {
      return { text: children, tags: preParsedTags }
    }
    const extracted = extractXmlTags(children)
    return {
      text: escapeXmlTags(extracted.text).replace(/\n{3,}/g, '\n\n').trim(),
      tags: extracted.tags,
    }
  }, [children, preParsedTags])

  return (
    <div className={className}>
      {text && <Markdown remarkPlugins={REMARK_PLUGINS} components={MD_COMPONENTS}>{text}</Markdown>}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 pt-2 border-t border-border-subtle">
          {tags.map((tag, i) => (
            <TagPill key={i} tag={tag} />
          ))}
        </div>
      )}
    </div>
  )
}
