export interface DocChunk {
  heading: string    // heading breadcrumb, e.g. "API Reference > useState"
  content: string    // chunk text
}

export interface ChunkedPage {
  title: string
  url: string
  chunks: DocChunk[]
}

const TARGET_CHUNK_SIZE = 1500 // characters

/**
 * Split markdown content into chunks based on heading boundaries.
 * Each chunk carries its heading breadcrumb for context.
 */
function splitByHeadings(markdown: string): DocChunk[] {
  const lines = markdown.split('\n')
  const chunks: DocChunk[] = []

  // Track heading hierarchy
  const headingStack: string[] = []
  let currentContent: string[] = []

  function flushChunk() {
    const content = currentContent.join('\n').trim()
    if (content.length > 0) {
      const heading = headingStack.join(' > ')

      // If the content is larger than target, split it further
      if (content.length > TARGET_CHUNK_SIZE * 2) {
        const subChunks = splitLargeContent(content, heading)
        chunks.push(...subChunks)
      } else {
        chunks.push({ heading, content })
      }
    }
    currentContent = []
  }

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/)
    if (headingMatch) {
      // Flush previous chunk
      flushChunk()

      const level = headingMatch[1].length
      const text = headingMatch[2].trim()

      // Update heading stack
      while (headingStack.length >= level) {
        headingStack.pop()
      }
      headingStack.push(text)

      currentContent.push(line)
    } else {
      currentContent.push(line)
    }
  }

  // Flush final chunk
  flushChunk()

  return chunks
}

/**
 * Split large content blocks into smaller chunks at paragraph boundaries
 */
function splitLargeContent(content: string, heading: string): DocChunk[] {
  const paragraphs = content.split(/\n\n+/)
  const chunks: DocChunk[] = []
  let current: string[] = []
  let currentSize = 0

  for (const para of paragraphs) {
    if (currentSize + para.length > TARGET_CHUNK_SIZE && current.length > 0) {
      chunks.push({
        heading,
        content: current.join('\n\n').trim(),
      })
      current = []
      currentSize = 0
    }
    current.push(para)
    currentSize += para.length
  }

  if (current.length > 0) {
    chunks.push({
      heading,
      content: current.join('\n\n').trim(),
    })
  }

  return chunks
}

/**
 * Chunk markdown content into searchable pieces.
 * Crawl4AI already produces clean markdown — we just split by headings.
 */
export function chunkMarkdown(markdown: string, url: string, title: string): ChunkedPage {
  const chunks = splitByHeadings(markdown)

  // Filter out empty/tiny chunks
  const filteredChunks = chunks.filter(c => c.content.length > 20)

  return {
    title,
    url,
    chunks: filteredChunks,
  }
}

/**
 * Extract unique heading breadcrumbs from markdown (for TOC generation).
 * Returns deduplicated heading strings like ["API Reference > useState", "Getting Started"].
 */
export function extractHeadings(markdown: string): string[] {
  const lines = markdown.split('\n')
  const headingStack: string[] = []
  const headings = new Set<string>()

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const text = headingMatch[2].trim()

      while (headingStack.length >= level) {
        headingStack.pop()
      }
      headingStack.push(text)

      headings.add(headingStack.join(' > '))
    }
  }

  return [...headings]
}
