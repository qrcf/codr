export function JsonHighlight({ data }: { data: unknown }) {
  const json = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  if (!json) return null

  const highlighted = json.replace(
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

export function formatValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined) return <span className="json-bool">null</span>
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (typeof parsed === 'object') {
        return <JsonHighlight data={parsed} />
      }
    } catch {
      // Not JSON
    }
    return <pre className="text-block">{value}</pre>
  }
  if (typeof value === 'object') {
    return <JsonHighlight data={value} />
  }
  return <pre className="text-block">{String(value)}</pre>
}
