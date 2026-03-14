/** Get total number of items in the unified dropdown for keyboard navigation */
export function getMentionItemCount(files: string[], docSources: DocSource[], query: string): number {
  const q = query.toLowerCase()
  const offset = !q ? 1 : 0
  const filteredDocs = docSources.filter(d => d.status === 'ready').filter(d => !q || d.name.toLowerCase().includes(q) || d.url.toLowerCase().includes(q)).slice(0, 5)
  const filteredFiles = (q ? files.filter((f) => f.toLowerCase().includes(q)) : files).slice(0, 15)
  return offset + filteredDocs.length + filteredFiles.length
}

/** Resolve active index to a file, doc, or find-references selection */
export function resolveMentionIndex(
  files: string[], docSources: DocSource[], query: string, index: number
): { type: 'file'; file: string } | { type: 'doc'; doc: DocSource } | { type: 'find-references' } | null {
  const q = query.toLowerCase()
  const offset = !q ? 1 : 0

  if (offset && index === 0) {
    return { type: 'find-references' }
  }

  const filteredDocs = docSources.filter(d => d.status === 'ready').filter(d => !q || d.name.toLowerCase().includes(q) || d.url.toLowerCase().includes(q)).slice(0, 5)
  const filteredFiles = (q ? files.filter((f) => f.toLowerCase().includes(q)) : files).slice(0, 15)

  const adjusted = index - offset
  if (adjusted < filteredDocs.length) {
    return { type: 'doc', doc: filteredDocs[adjusted] }
  }
  const fileIndex = adjusted - filteredDocs.length
  if (fileIndex < filteredFiles.length) {
    return { type: 'file', file: filteredFiles[fileIndex] }
  }
  return null
}
