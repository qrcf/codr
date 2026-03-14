export interface ExtractedTag {
  tag: string
  content: string
}

/**
 * Extracts all XML-like tag blocks from content, returning the cleaned text
 * and an array of extracted {tag, content} pairs. Handles both single-line
 * and multiline tag blocks. Skips tags inside markdown code fences or inline code.
 * Known system tags (system-reminder, command-name, etc.) are NOT extracted —
 * they're handled separately by formatMessageContent.
 */
export function extractXmlTags(content: string): { text: string; tags: ExtractedTag[] } {
  const tags: ExtractedTag[] = []

  // Build a set of character ranges that are inside code fences or inline code
  const codeRanges: [number, number][] = []
  // Fenced code blocks: ```...```
  const fenceRe = /```[\s\S]*?```/g
  let m: RegExpExecArray | null
  while ((m = fenceRe.exec(content))) codeRanges.push([m.index, m.index + m[0].length])
  // Inline code: `...`
  const inlineRe = /`[^`]+`/g
  while ((m = inlineRe.exec(content))) codeRanges.push([m.index, m.index + m[0].length])

  const isInsideCode = (idx: number) => codeRanges.some(([start, end]) => idx >= start && idx < end)

  const text = content.replace(/<([a-zA-Z][a-zA-Z0-9_:-]*)\b[^>]*>([\s\S]*?)<\/\1>/g, (_match, tag: string, inner: string, offset: number) => {
    if (isInsideCode(offset)) return _match // leave code blocks intact
    const trimmed = inner.trim()
    if (!trimmed || /^\.{1,5}$/.test(trimmed) || trimmed === '…') return '' // strip placeholder tags
    tags.push({ tag, content: trimmed })
    return ''
  })
  return { text, tags }
}

/**
 * Escapes XML/HTML-like tags so react-markdown renders them as literal text
 * instead of silently stripping them. Handles opening tags (<foo>, <foo attr>),
 * closing tags (</foo>), and self-closing tags (<foo/>).
 */
export function escapeXmlTags(content: string): string {
  // Match opening/closing tags: <tagname, </tagname — followed by whitespace, >, or /
  // Also handles tags at end of string (partial/streaming)
  return content.replace(/<(\/?[a-zA-Z][a-zA-Z0-9_:-]*)([\s>/]|$)/g, '\\<$1$2')
}

/**
 * Preprocesses message content to convert raw XML-like tags
 * from Claude Code slash commands into formatted markdown.
 * Returns cleaned text + any extracted metadata tags for styled rendering.
 */
export function formatMessageContent(content: string): { text: string; tags: ExtractedTag[] } {
  let result = content

  // Strip <system-reminder>...</system-reminder> blocks entirely (multiline)
  result = result.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')

  // Convert <command-name>/foo</command-name> to inline code
  result = result.replace(/<command-name>(.*?)<\/command-name>/g, '`$1`')

  // Strip <command-message>...</command-message> (redundant with command-name)
  result = result.replace(/<command-message>.*?<\/command-message>/g, '')

  // Handle <command-args>: strip if empty, show content if present
  result = result.replace(/<command-args>(.*?)<\/command-args>/g, (_match, args: string) => {
    return args.trim() ? ` ${args.trim()}` : ''
  })

  // Wrap @file/path references in backticks for styled rendering
  result = result.replace(/(?<!`)(@(?:[a-zA-Z0-9_-]+\/)+[a-zA-Z0-9_./-]*|@[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9]{1,10})+)(?!`)/g, '`$1`')

  // Convert <local-command-stdout>...</local-command-stdout> to a subtle output
  result = result.replace(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/g, (_match, output: string) => {
    const trimmed = output.trim()
    return trimmed ? `\n> ${trimmed}\n` : ''
  })

  // Extract remaining XML-like tags as structured metadata
  const { text: cleaned, tags } = extractXmlTags(result)

  // Escape any straggler angle brackets (unclosed/malformed tags)
  let text = escapeXmlTags(cleaned)

  // Clean up excessive whitespace left behind
  text = text.replace(/\n{3,}/g, '\n\n').trim()

  return { text, tags }
}
