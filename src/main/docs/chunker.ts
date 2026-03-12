import * as cheerio from 'cheerio'
import TurndownService from 'turndown'

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
 * Remove non-content elements from HTML (nav, footer, sidebar, scripts, etc.)
 */
function stripNonContent(html: string): string {
  const $ = cheerio.load(html)

  // Remove elements that are typically not documentation content
  $('script, style, noscript, iframe').remove()
  $('nav, header, footer').remove()
  $('[role="navigation"], [role="banner"], [role="contentinfo"]').remove()
  $('[class*="sidebar"], [class*="nav-"], [class*="menu"], [class*="footer"], [class*="header"]').remove()
  $('[id*="sidebar"], [id*="nav-"], [id*="menu"], [id*="footer"], [id*="header"]').remove()
  $('[class*="toc"], [class*="breadcrumb"]').remove()
  $('[class*="cookie"], [class*="banner"], [class*="popup"]').remove()

  // Try to find main content container
  const mainContent = $('main, [role="main"], article, .content, .documentation, .doc-content, #content, #main').first()
  if (mainContent.length > 0) {
    return mainContent.html() || $.html()
  }

  return $('body').html() || $.html()
}

/**
 * Extract the page title from HTML
 */
function extractTitle(html: string): string {
  const $ = cheerio.load(html)
  // Try various title sources
  const title = $('h1').first().text().trim()
    || $('title').text().trim()
    || $('meta[property="og:title"]').attr('content')?.trim()
    || ''
  return title
}

/**
 * Create a turndown service configured for documentation content
 */
function createTurndown(): TurndownService {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  })

  // Preserve code blocks
  turndown.addRule('codeBlock', {
    filter: (node) => {
      return node.nodeName === 'PRE' && node.querySelector('code') !== null
    },
    replacement: (_content, node) => {
      const el = node as unknown as { querySelector: (s: string) => { className?: string; textContent?: string } | null }
      const code = el.querySelector('code')
      const lang = code?.className?.match(/language-(\w+)/)?.[1] || ''
      const text = code?.textContent || ''
      return `\n\`\`\`${lang}\n${text}\n\`\`\`\n`
    },
  })

  return turndown
}

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
 * Extract content from HTML and split into searchable chunks.
 * Pipeline: HTML → strip non-content → markdown → split by headings
 */
export function extractAndChunk(html: string, url: string): ChunkedPage {
  const title = extractTitle(html)
  const cleanHtml = stripNonContent(html)

  const turndown = createTurndown()
  const markdown = turndown.turndown(cleanHtml)

  const chunks = splitByHeadings(markdown)

  // Filter out empty/tiny chunks
  const filteredChunks = chunks.filter(c => c.content.length > 50)

  return {
    title,
    url,
    chunks: filteredChunks,
  }
}
