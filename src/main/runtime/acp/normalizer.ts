/**
 * Normalize ACP tool calls to Claude SDK-compatible format so both providers
 * share the same set of renderers.
 *
 * Maps ACP `kind`/`title` → canonical Claude SDK tool name,
 * and ACP `rawInput` fields → Claude SDK input field names.
 */

// --- Title → SDK kind lookup (all lowercase) ---

const TITLE_TO_KIND: Record<string, string> = {
  // Bash
  run_terminal_command: 'Bash',
  bash_command: 'Bash',
  execute_command: 'Bash',
  terminal_command: 'Bash',
  shell: 'Bash',
  list_directory: 'Bash',
  list_dir: 'Bash',
  run_command: 'Bash',

  // Read
  read_file: 'Read',
  read: 'Read',
  view_file: 'Read',
  cat_file: 'Read',
  get_file_contents: 'Read',
  view: 'Read',

  // Edit
  edit_file: 'Edit',
  edit: 'Edit',
  apply_diff: 'Edit',
  replace_in_file: 'Edit',
  str_replace_editor: 'Edit',

  // Write
  create_file: 'Write',
  write_file: 'Write',
  write_new_file: 'Write',
  create_new_file: 'Write',
  write: 'Write',

  // Grep
  grep_search: 'Grep',
  grep: 'Grep',
  codebase_search: 'Grep',
  search_files: 'Grep',
  ripgrep: 'Grep',
  code_search: 'Grep',
  regex_search: 'Grep',
  search: 'Grep',
  find: 'Grep',

  // Glob
  glob_file_search: 'Glob',
  glob: 'Glob',
  file_search: 'Glob',
  find_files: 'Glob',
  list_files: 'Glob',
  find_by_name: 'Glob',
  file_list: 'Glob',

  // WebFetch / WebSearch
  fetch_url: 'WebFetch',
  web_fetch: 'WebFetch',
  url_fetch: 'WebFetch',
  web_search: 'WebSearch',
  search_web: 'WebSearch',

  // Agent
  subagent: 'Agent',
  delegate: 'Agent',

  // TodoWrite
  todowrite: 'TodoWrite',
}

// ACP kind → default SDK kind
const KIND_MAP: Record<string, string> = {
  execute: 'Bash',
  read: 'Read',
  edit: 'Edit',
  delete: 'Bash',
  move: 'Bash',
  search: 'Grep',
  fetch: 'WebFetch',
  think: 'Agent',
  switch_mode: 'ExitPlanMode',
}

// Titles that refine 'edit' kind → 'Write'
const WRITE_TITLES = new Set(['create_file', 'write_file', 'write_new_file', 'create_new_file', 'write'])

// Titles that refine 'search' kind → 'Glob'
const GLOB_TITLES = new Set(['glob_file_search', 'glob', 'file_search', 'find_files', 'list_files', 'find_by_name', 'file_list'])

// --- Input field mappers ---

type Location = { path: string; line?: number | null }

function filePath(raw: Record<string, unknown>, locations?: Location[]): string {
  return (raw.file_path ?? raw.filePath ?? raw.path ?? raw.target_file ?? raw.file ?? locations?.[0]?.path ?? '') as string
}

function mapBash(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    command: raw.command ?? raw.cmd ?? raw.shell_command ?? raw.terminal_command ?? '',
  }
  if (raw.description != null) out.description = raw.description
  if (raw.timeout != null) out.timeout = raw.timeout
  return out
}

function mapRead(raw: Record<string, unknown>, locations?: Location[]): Record<string, unknown> {
  const out: Record<string, unknown> = { file_path: filePath(raw, locations) }
  if (raw.offset != null) out.offset = raw.offset
  if (raw.limit != null) out.limit = raw.limit
  if (raw.start_line != null && raw.offset == null) out.offset = raw.start_line
  if (raw.end_line != null && raw.start_line != null && raw.limit == null) {
    out.limit = Number(raw.end_line) - Number(raw.start_line)
  }
  return out
}

function mapEdit(raw: Record<string, unknown>, locations?: Location[]): Record<string, unknown> {
  const out: Record<string, unknown> = {
    file_path: filePath(raw, locations),
    old_string: raw.old_string ?? raw.old_str ?? raw.oldText ?? raw.original ?? '',
    new_string: raw.new_string ?? raw.new_str ?? raw.newText ?? raw.replacement ?? '',
  }
  if (raw.replace_all != null) out.replace_all = raw.replace_all
  return out
}

function mapWrite(raw: Record<string, unknown>, locations?: Location[]): Record<string, unknown> {
  return {
    file_path: filePath(raw, locations),
    content: raw.content ?? raw.file_text ?? raw.text ?? raw.code ?? '',
  }
}

function mapGrep(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    pattern: raw.pattern ?? raw.query ?? raw.search_pattern ?? raw.regex ?? raw.searchQuery ?? raw.search ?? '',
  }
  if (raw.path != null) out.path = raw.path
  else if (raw.directory != null) out.path = raw.directory
  else if (raw.folder != null) out.path = raw.folder
  if (raw.glob != null) out.glob = raw.glob
  else if (raw.include != null) out.glob = raw.include
  else if (raw.includePattern != null) out.glob = raw.includePattern
  if (raw.output_mode != null) out.output_mode = raw.output_mode
  return out
}

function mapGlob(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    pattern: raw.pattern ?? raw.query ?? raw.search_pattern ?? raw.file_pattern ?? raw.searchQuery ?? '',
  }
  if (raw.path != null) out.path = raw.path
  else if (raw.directory != null) out.path = raw.directory
  return out
}

function mapAgent(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    description: raw.description ?? raw.task ?? '',
  }
  if (raw.prompt != null) out.prompt = raw.prompt
  return out
}

// --- Main normalizer ---

export interface NormalizedTool {
  kind: string
  input: Record<string, unknown>
}

export function normalizeAcpTool(
  acpKind: string,
  title: string,
  rawInput: Record<string, unknown>,
  locations?: Location[],
): NormalizedTool {
  // Phase 1: Resolve kind from ACP kind
  let kind = KIND_MAP[acpKind]

  // Phase 2: Refine using title (case-insensitive, underscore-normalized)
  const titleLower = title.toLowerCase().replace(/\s+/g, '_')
  const titleKind = TITLE_TO_KIND[titleLower]

  if (titleKind) {
    // Title takes precedence for disambiguation
    kind = titleKind
  } else if (!kind) {
    // Unknown ACP kind and no title match — keep original
    return { kind: acpKind, input: rawInput }
  }

  // Refine ambiguous mappings using title
  if (kind === 'Edit' && WRITE_TITLES.has(titleLower)) kind = 'Write'
  if (kind === 'Grep' && GLOB_TITLES.has(titleLower)) kind = 'Glob'
  // Also detect Write from rawInput shape: has content but no old_string/new_string
  if (kind === 'Edit' && !('old_string' in rawInput) && !('old_str' in rawInput) && ('content' in rawInput || 'file_text' in rawInput)) {
    kind = 'Write'
  }

  // Phase 3: Map input fields — always map through the normalizer to ensure
  // canonical field names. The mapper functions handle multiple input variants.
  let input: Record<string, unknown>

  switch (kind) {
    case 'Bash':
      input = mapBash(rawInput)
      break
    case 'Read':
      input = mapRead(rawInput, locations)
      break
    case 'Edit':
      input = mapEdit(rawInput, locations)
      break
    case 'Write':
      input = mapWrite(rawInput, locations)
      break
    case 'Grep':
      input = mapGrep(rawInput)
      break
    case 'Glob':
      input = mapGlob(rawInput)
      break
    case 'Agent':
      input = mapAgent(rawInput)
      break
    default:
      input = rawInput
      break
  }

  return { kind, input }
}
