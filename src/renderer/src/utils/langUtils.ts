/** Maps file extensions to registered Prism language names */
export const EXT_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  py: 'python',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  md: 'markdown',
  mdx: 'markdown',
  rs: 'rust',
  go: 'go',
  java: 'java',
  yaml: 'yaml',
  yml: 'yaml',
  sql: 'sql',
  html: 'markup',
  htm: 'markup',
  xml: 'markup',
  svg: 'markup',
  toml: 'toml',
  c: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  swift: 'swift',
  kt: 'kotlin',
  kts: 'kotlin',
  rb: 'ruby',
  diff: 'diff',
  patch: 'diff',
}

/** Maps markdown fenced-block language identifiers to registered Prism language names */
export const LANG_ALIAS: Record<string, string> = {
  html: 'markup',
  xml: 'markup',
  svg: 'markup',
  shell: 'bash',
  sh: 'bash',
  zsh: 'bash',
  fish: 'bash',
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  yml: 'yaml',
  rb: 'ruby',
  cs: 'csharp',
  kt: 'kotlin',
}

/** Infer a Prism language from a file path by extension */
export function langFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return EXT_MAP[ext] ?? 'text'
}

/** Resolve a markdown code-fence language identifier to a registered Prism language */
export function normalizeLang(lang: string): string {
  const lower = lang.toLowerCase()
  return LANG_ALIAS[lower] ?? lower
}
