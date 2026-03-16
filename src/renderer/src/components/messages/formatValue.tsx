import { JsonHighlight } from './JsonHighlight'

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
