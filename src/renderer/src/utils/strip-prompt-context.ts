export function stripPromptContext(text: string | undefined | null): string {
  if (!text) return ''
  return text
    .replace(/<codebase_context>[\s\S]*?<\/codebase_context>\s*/g, '')
    .replace(/<file_context>[\s\S]*?<\/file_context>\s*/g, '')
    .replace(/<documentation_context>[\s\S]*?<\/documentation_context>\s*/g, '')
    .replace(/<documentation_sources>[\s\S]*?<\/documentation_sources>\s*/g, '')
    .trim()
}
