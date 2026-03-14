function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function JsonHighlight({ data }: { data: unknown }) {
  const json = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  if (!json) return null

  // Escape HTML entities first so XML-like tags in values don't get parsed as HTML
  const highlighted = escapeHtml(json).replace(
    /("(?:\\.|[^"\\])*")\s*:/g,
    '<span class="json-key">$1</span>:',
  ).replace(
    /:\s*("(?:\\.|[^"\\])*")/g,
    ': <span class="json-string">$1</span>',
  ).replace(
    /:\s*(\d+\.?\d*)/g,
    ': <span class="json-number">$1</span>',
  ).replace(
    /:\s*(true|false|null)/g,
    ': <span class="json-bool">$1</span>',
  )

  return <pre className="json-block" dangerouslySetInnerHTML={{ __html: highlighted }} />
}

