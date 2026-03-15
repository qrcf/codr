import { useState, useEffect, useRef, useCallback } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { DiffView } from './DiffView'
import { useCodr } from '../hooks/useCodr'

interface ManageProjectPanelProps {
  folderPath: string
  onClose: () => void
}

type Tab = 'general' | 'files'
type UpdateState = 'idle' | 'updating' | 'reviewing'

const PRESET_PROMPTS: { label: string; prompt: string }[] = [
  {
    label: 'Generate project overview',
    prompt: 'Read the codebase and generate or update the CLAUDE.md file with a comprehensive project overview including: what the project does, main technologies used, project structure, and how to get started.',
  },
  {
    label: 'Document coding conventions',
    prompt: 'Analyze the codebase and update the CLAUDE.md file to document the coding conventions and patterns used, including: naming conventions, file organization, component patterns, and style guidelines.',
  },
  {
    label: 'Add dependency info',
    prompt: 'Read package.json and other config files, then update the CLAUDE.md file to include information about key dependencies, what they are used for, and any important version constraints.',
  },
  {
    label: 'Summarize architecture',
    prompt: 'Analyze the codebase architecture and update the CLAUDE.md file with an architecture summary including: main modules, data flow, key abstractions, and how different parts of the system interact.',
  },
]

export function ManageProjectPanel({ folderPath, onClose }: ManageProjectPanelProps) {
  const codr = useCodr()
  const [activeTab, setActiveTab] = useState<Tab>('general')
  const [claudeMdContent, setClaudeMdContent] = useState<string | null>(null)
  const [claudeMdLoading, setClaudeMdLoading] = useState(true)
  const [updateState, setUpdateState] = useState<UpdateState>('idle')
  const [proposedContent, setProposedContent] = useState<string | null>(null)
  const [freeTextInput, setFreeTextInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [updateLabel, setUpdateLabel] = useState('')
  const collectedResponseRef = useRef('')
  const cleanupRef = useRef<(() => void) | null>(null)

  // Load CLAUDE.md on mount
  useEffect(() => {
    loadClaudeMd()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run when folderPath changes; loadClaudeMd reads folderPath
  }, [folderPath])

  async function loadClaudeMd() {
    setClaudeMdLoading(true)
    setError(null)
    try {
      const result = await codr.readClaudeMd?.(folderPath)
      if (result?.error) {
        setError(result.error)
        setClaudeMdContent(null)
      } else {
        setClaudeMdContent(result?.content ?? null)
      }
    } catch (err) {
      setError(String(err))
      setClaudeMdContent(null)
    } finally {
      setClaudeMdLoading(false)
    }
  }

  function triggerUpdate(prompt: string, label: string) {
    setUpdateState('updating')
    setUpdateLabel(label)
    setError(null)
    setProposedContent(null)
    collectedResponseRef.current = ''

    const currentContent = claudeMdContent || ''
    const fullPrompt = `You are updating the CLAUDE.md file for the project at ${folderPath}.

${currentContent ? `Here is the current CLAUDE.md content:\n\`\`\`\n${currentContent}\n\`\`\`` : 'There is no CLAUDE.md file yet.'}

Task: ${prompt}

IMPORTANT: Output ONLY the complete updated CLAUDE.md content. Do not include any explanation, preamble, or markdown code fences around the entire output. Just output the raw markdown content that should be written to CLAUDE.md.`

    // Listen for messages to collect the response
    const unsubMessage = codr.onMessage((message: unknown) => {
      const msg = message as { type?: string; message?: { content?: Array<{ type?: string; text?: string }> } }
      if (msg?.type === 'assistant' && msg?.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text) {
            collectedResponseRef.current = block.text
          }
        }
      }
    })

    const unsubDone = codr.onDone(() => {
      cleanup()
      const response = collectedResponseRef.current.trim()
      if (response) {
        // Strip wrapping code fences if present
        let cleaned = response
        if (cleaned.startsWith('```markdown\n') || cleaned.startsWith('```md\n') || cleaned.startsWith('```\n')) {
          cleaned = cleaned.replace(/^```(?:markdown|md)?\n/, '').replace(/\n```$/, '')
        }
        setProposedContent(cleaned)
        setUpdateState('reviewing')
      } else {
        setError('No response received from Claude')
        setUpdateState('idle')
      }
    })

    const unsubError = codr.onError((err: string) => {
      cleanup()
      setError(err)
      setUpdateState('idle')
    })

    function cleanup() {
      unsubMessage()
      unsubDone()
      unsubError()
      cleanupRef.current = null
    }

    cleanupRef.current = cleanup

    // Fire the query
    codr.query(fullPrompt, { cwd: folderPath }).catch((err) => {
      cleanup()
      setError(String(err))
      setUpdateState('idle')
    })
  }

  async function handleAccept() {
    if (!proposedContent) return
    setError(null)
    try {
      const result = await codr.writeClaudeMd?.(folderPath, proposedContent)
      if (result?.error) {
        setError(result.error)
        return
      }
      setClaudeMdContent(proposedContent)
      setProposedContent(null)
      setUpdateState('idle')
    } catch (err) {
      setError(String(err))
    }
  }

  function handleReject() {
    setProposedContent(null)
    setUpdateState('idle')
  }

  function handleFreeTextSubmit() {
    const text = freeTextInput.trim()
    if (!text) return
    setFreeTextInput('')
    triggerUpdate(text, 'Custom update')
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupRef.current?.()
    }
  }, [])

  const folderName = folderPath.split('/').filter(Boolean).pop() || folderPath

  const tabBtnClass = (isActive: boolean) =>
    `bg-transparent border-0 border-b-2 px-5 py-3.5 text-[14px] cursor-pointer transition-colors duration-150 ${
      isActive
        ? 'text-[#e0e0e0] border-b-accent'
        : 'text-text-faint border-b-transparent hover:text-[#ccc]'
    }`

  return (
    <div className="flex flex-col flex-1 h-screen min-w-0 bg-bg-primary">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 shrink-0">
        <div className="min-w-0">
          <div className="text-[18px] font-semibold text-[#e0e0e0] overflow-hidden text-ellipsis whitespace-nowrap">{folderName}</div>
          <div className="text-[12px] text-text-dim mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">{folderPath}</div>
        </div>
        <button
          className="bg-transparent border border-border text-text-faint w-8 h-8 rounded-md cursor-pointer flex items-center justify-center text-[16px] transition-colors duration-150 shrink-0 hover:bg-border-subtle hover:text-[#ccc]"
          onClick={onClose}
          title="Close"
        >
          ✕
        </button>
      </div>

      {/* Topbar / Tabs */}
      <div className="flex items-center px-4 border-b border-border-subtle shrink-0">
        <div className="flex gap-0">
          <button className={tabBtnClass(activeTab === 'general')} onClick={() => setActiveTab('general')}>
            General
          </button>
          <button className={tabBtnClass(activeTab === 'files')} onClick={() => setActiveTab('files')}>
            Files
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 px-8 py-6 overflow-y-auto text-[#bbb] text-[14px] max-sm:px-4">
        {activeTab === 'general' && (
          <div>
            {/* CLAUDE.md content */}
            <section className="mb-8">
              <h3 className="m-0 mb-3 text-[13px] font-semibold text-text-faint uppercase tracking-[0.05em]">CLAUDE.md</h3>
              {claudeMdLoading ? (
                <div className="text-text-dim italic">Loading CLAUDE.md...</div>
              ) : claudeMdContent ? (
                <div className="mp-claudemd-card bg-bg-tertiary border border-border-subtle rounded-lg px-6 py-5 max-h-[50vh] overflow-y-auto">
                  <Markdown remarkPlugins={[remarkGfm]}>{claudeMdContent}</Markdown>
                </div>
              ) : (
                <div className="mp-claudemd-card bg-bg-tertiary border border-border-subtle rounded-lg px-6 py-5 max-h-[50vh] overflow-y-auto">
                  <div className="text-text-dim italic px-6 py-6 text-center">
                    No CLAUDE.md found in this project. Use the actions below to generate one.
                  </div>
                </div>
              )}
            </section>

            {/* Update actions */}
            {updateState === 'idle' && (
              <section className="mb-8">
                <h3 className="m-0 mb-3 text-[13px] font-semibold text-text-faint uppercase tracking-[0.05em]">Update CLAUDE.md</h3>
                <div className="mt-4">
                  <div className="flex flex-wrap gap-2 mb-3">
                    {PRESET_PROMPTS.map((preset) => (
                      <button
                        key={preset.label}
                        className="bg-[#2a2a3d] border border-[#3a3a5a] text-[#ccc] px-3.5 py-1.75 rounded-md cursor-pointer text-[13px] transition-colors duration-150 hover:bg-[#3a3a5a] hover:text-[#e0e0e0] hover:border-accent disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => triggerUpdate(preset.prompt, preset.label)}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      className="flex-1 bg-bg-tertiary border border-border-subtle text-[#e0e0e0] px-3 py-2 rounded-md text-[13px] outline-none transition-colors duration-150 focus:border-accent placeholder:text-[#555]"
                      type="text"
                      placeholder="Describe what to update (e.g., 'Add info about our API auth pattern')"
                      value={freeTextInput}
                      onChange={(e) => setFreeTextInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          handleFreeTextSubmit()
                        }
                      }}
                    />
                    <button
                      className="bg-accent border-none text-white px-4.5 py-2 rounded-md cursor-pointer text-[13px] font-medium transition-colors duration-150 whitespace-nowrap hover:bg-[#9656d8] disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={handleFreeTextSubmit}
                      disabled={!freeTextInput.trim()}
                    >
                      Update
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* Updating spinner */}
            {updateState === 'updating' && (
              <section className="mb-8">
                <div className="flex items-center gap-2.5 text-text-faint italic py-4">
                  <div className="w-4 h-4 border-2 border-border border-t-accent rounded-full animate-[spin_0.8s_linear_infinite]" />
                  <span>Claude is working on: {updateLabel}...</span>
                </div>
              </section>
            )}

            {/* Diff review */}
            {updateState === 'reviewing' && proposedContent && (
              <section className="mb-8">
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-2.5 max-sm:flex-col max-sm:items-start max-sm:gap-2">
                    <h4 className="m-0 text-[#ccc] text-[14px]">Proposed changes</h4>
                    <div className="flex gap-2">
                      <button
                        className="bg-[#2d6a2d] border border-[#3d8a3d] text-[#d0f0d0] px-4 py-1.5 rounded-md cursor-pointer text-[13px] transition-colors duration-150 hover:bg-[#3d8a3d]"
                        onClick={handleAccept}
                      >
                        Accept
                      </button>
                      <button
                        className="bg-bg-tertiary border border-border text-text-faint px-4 py-1.5 rounded-md cursor-pointer text-[13px] transition-colors duration-150 hover:bg-border-subtle hover:text-[#ccc]"
                        onClick={handleReject}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                  <div className="bg-[#0e0e16] border border-border-subtle rounded-lg p-3 max-h-[50vh] overflow-y-auto">
                    <DiffView
                      oldString={claudeMdContent || ''}
                      newString={proposedContent}
                      maxLines={200}
                    />
                  </div>
                </div>
              </section>
            )}

            {/* Error */}
            {error && <div className="text-[#e06060] text-[13px] mt-2">{error}</div>}
          </div>
        )}

        {activeTab === 'files' && (
          <div>
            <ProjectFilesConfigSection folderPath={folderPath} />
            <ComputedIgnoresSection folderPath={folderPath} />
            <ProjectIndexTab folderPath={folderPath} />
          </div>
        )}
      </div>
    </div>
  )
}

// -- Chip list helper (shared) --

function ChipList({
  items,
  onRemove,
  placeholder,
  onAdd,
}: {
  items: string[]
  onRemove: (item: string) => void
  placeholder: string
  onAdd: (item: string) => void
}) {
  const [input, setInput] = useState('')

  function commit() {
    const val = input.trim().replace(/\/$/, '')
    if (!val || items.includes(val)) { setInput(''); return }
    onAdd(val)
    setInput('')
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2 min-h-7">
        {items.map((item) => (
          <span
            key={item}
            className="flex items-center gap-1 px-2 py-0.5 bg-bg-tertiary border border-border-subtle rounded text-[12px] text-[#ccc] font-mono"
          >
            {item}
            <button
              className="bg-transparent border-0 text-[#555] cursor-pointer p-0 ml-0.5 leading-none hover:text-[#e06060]"
              onClick={() => onRemove(item)}
              title={`Remove ${item}`}
            >
              ×
            </button>
          </span>
        ))}
        {items.length === 0 && <span className="text-[12px] text-[#555] italic">None</span>}
      </div>
      <div className="flex gap-2">
        <input
          className="flex-1 bg-bg-tertiary border border-border-subtle text-[#e0e0e0] px-2.5 py-1.5 rounded text-[12px] outline-none focus:border-accent placeholder:text-[#555] font-mono"
          type="text"
          placeholder={placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
        />
        <button
          className="bg-[#2a2a3d] border border-[#3a3a5a] text-[#ccc] px-3 py-1.5 rounded text-[12px] cursor-pointer transition-colors hover:bg-[#3a3a5a] disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={commit}
          disabled={!input.trim()}
        >
          Add
        </button>
      </div>
    </div>
  )
}

// -- Project files config section --

function ProjectFilesConfigSection({ folderPath }: { folderPath: string }) {
  const codr = useCodr()
  const [projectConfig, setProjectConfig] = useState<ProjectFilesConfigFile>({})

  useEffect(() => {
    codr.getProjectFilesConfig?.(folderPath)
      .then((p) => { if (p) setProjectConfig(p) })
      .catch(() => {})
  }, [folderPath, codr])

  async function save(updates: Partial<ProjectFilesConfigFile>) {
    const merged = { ...projectConfig, ...updates }
    setProjectConfig(merged)
    await codr.setProjectFilesConfig?.(folderPath, merged).catch(() => {})
  }

  return (
    <section className="mb-6">
      <h3 className="m-0 mb-3 text-[13px] font-semibold text-text-faint uppercase tracking-[0.05em]">File Discovery Overrides</h3>
      <div className="bg-bg-tertiary border border-border-subtle rounded-lg p-4 space-y-5">

        {/* Extra ignore dirs */}
        <div>
          <div className="text-[13px] text-[#ccc] font-medium mb-1.5">Extra ignore directories</div>
          <div className="text-[12px] text-[#555] mb-2">Project-specific directory names to exclude (in addition to global settings)</div>
          <ChipList
            items={projectConfig.extraIgnoreDirs ?? []}
            placeholder="e.g. e2e, fixtures"
            onAdd={(dir) => save({ extraIgnoreDirs: [...(projectConfig.extraIgnoreDirs ?? []), dir] })}
            onRemove={(dir) => save({ extraIgnoreDirs: (projectConfig.extraIgnoreDirs ?? []).filter((d) => d !== dir) })}
          />
        </div>

        {/* Extra patterns */}
        <div>
          <div className="text-[13px] text-[#ccc] font-medium mb-1.5">Extra ignore patterns</div>
          <div className="text-[12px] text-[#555] mb-2">gitignore-style patterns applied only to this project (e.g. <span className="font-mono">src/generated/**</span>)</div>
          <ChipList
            items={projectConfig.extraPatterns ?? []}
            placeholder="e.g. src/generated/**, *.snap"
            onAdd={(p) => save({ extraPatterns: [...(projectConfig.extraPatterns ?? []), p] })}
            onRemove={(p) => save({ extraPatterns: (projectConfig.extraPatterns ?? []).filter((x) => x !== p) })}
          />
        </div>
      </div>
    </section>
  )
}

// -- Computed ignores section --

const SOURCE_BADGE: Record<IgnoreSource, { label: string; className: string }> = {
  'global':       { label: 'global',       className: 'bg-[#1a2035] text-[#6b8dd6]' },
  'gitignore':    { label: '.gitignore',   className: 'bg-[#1a2e1a] text-[#50c878]' },
  'codrignore':   { label: '.codrignore',  className: 'bg-[#2d1f3d] text-[#b89de0]' },
  'cursorignore': { label: '.cursorignore',className: 'bg-[#2a2820] text-[#c8a84b]' },
  'copilotignore':{ label: '.copilotignore',className: 'bg-[#2a2820] text-[#c8a84b]' },
  'aiderignore':  { label: '.aiderignore', className: 'bg-[#2a2820] text-[#c8a84b]' },
  'project':      { label: 'project',      className: 'bg-[#2e1e14] text-[#d4845a]' },
}

function ComputedIgnoresSection({ folderPath }: { folderPath: string }) {
  const codr = useCodr()
  const [entries, setEntries] = useState<TaggedIgnoreEntry[]>([])
  const [expanded, setExpanded] = useState(false)
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const loaded = useRef(false)

  useEffect(() => {
    if (!expanded || loaded.current) return
    loaded.current = true
    void (async () => {
      setLoading(true)
      try {
        const e = await codr.getComputedIgnores?.(folderPath)
        setEntries(e ?? [])
      } catch {
        // ignore
      } finally {
        setLoading(false)
      }
    })()
  }, [expanded, folderPath, codr])

  // Reload when expanded is toggled open (allows refresh after config changes)
  const handleToggle = () => {
    if (!expanded) loaded.current = false
    setExpanded(!expanded)
  }

  const filtered = filter
    ? entries.filter((e) => e.pattern.toLowerCase().includes(filter.toLowerCase()) || e.source.includes(filter.toLowerCase()))
    : entries

  return (
    <section className="mb-6">
      <button
        className="flex items-center gap-2 bg-transparent border-0 p-0 cursor-pointer mb-3 group"
        onClick={handleToggle}
      >
        <span className="text-[13px] font-semibold text-text-faint uppercase tracking-[0.05em] group-hover:text-[#bbb] transition-colors">
          Computed Ignores
        </span>
        <span className="text-text-dim text-[11px] transition-transform" style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
          ▶
        </span>
        {entries.length > 0 && <span className="text-[11px] text-[#555]">({entries.length})</span>}
      </button>

      {expanded && (
        <div className="bg-bg-tertiary border border-border-subtle rounded-lg overflow-hidden">
          {loading ? (
            <div className="text-[12px] text-text-dim italic px-4 py-3">Loading...</div>
          ) : (
            <>
              <div className="px-3 py-2 border-b border-border-subtle">
                <input
                  className="w-full bg-[#141420] border border-border-subtle text-[#e0e0e0] px-2.5 py-1.5 rounded text-[12px] outline-none focus:border-accent placeholder:text-[#555] font-mono"
                  type="text"
                  placeholder="Filter patterns or sources..."
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>
              <div className="max-h-100 overflow-y-auto">
                {filtered.length === 0 ? (
                  <div className="text-[12px] text-[#555] italic px-4 py-3">No entries match filter</div>
                ) : (
                  filtered.map((entry, i) => {
                    const badge = SOURCE_BADGE[entry.source] ?? SOURCE_BADGE['global']
                    return (
                      <div
                        key={i}
                        className="flex items-center gap-2 px-3 py-1.5 border-b border-bg-card last:border-b-0 hover:bg-[#222238] transition-colors duration-100"
                      >
                        <span className="text-[12px] text-[#ccc] font-mono flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                          {entry.pattern}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-[10px] shrink-0 ${badge.className}`}>
                          {badge.label}
                        </span>
                      </div>
                    )
                  })
                )}
              </div>
              {filtered.length > 0 && filtered.length < entries.length && (
                <div className="text-[11px] text-[#555] px-3 py-2 border-t border-border-subtle">
                  Showing {filtered.length} of {entries.length} patterns
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}

// -- Language display helpers --

const LANG_LABELS: Record<string, { label: string; color: string }> = {
  ts: { label: 'TypeScript', color: '#3178c6' },
  py: { label: 'Python', color: '#3776ab' },
  go: { label: 'Go', color: '#00add8' },
  rs: { label: 'Rust', color: '#dea584' },
  unknown: { label: 'Other', color: '#666' },
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface IndexedFile {
  path: string
  chunkCount: number
  language: string
  size: number
}

function ProjectIndexTab({ folderPath }: { folderPath: string }) {
  const codr = useCodr()
  const [globalStatus, setGlobalStatus] = useState<{ status: string; detail?: string }>({ status: 'not-ready' })
  const [projectStatus, setProjectStatus] = useState<{ status: string; fileCount?: number; detail?: string }>({ status: 'not-indexed' })
  const [rebuilding, setRebuilding] = useState(false)
  const [indexingDetail, setIndexingDetail] = useState<string | null>(null)
  const [indexingProgress, setIndexingProgress] = useState<{ current: number; total: number } | null>(null)
  const [files, setFiles] = useState<IndexedFile[]>([])
  const [filesExpanded, setFilesExpanded] = useState(false)
  const [fileFilter, setFileFilter] = useState('')
  const [hoveredFile, setHoveredFile] = useState<IndexedFile | null>(null)
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })

  const loadFiles = useCallback(() => {
    codr.getIndexerProjectFiles?.(folderPath).then(f => setFiles(f || [])).catch(() => {})
  }, [folderPath, codr])

  useEffect(() => {
    codr.getIndexerStatus?.().then(setGlobalStatus).catch(() => {})
    codr.getIndexerProjectStatus?.(folderPath).then((s) => {
      setProjectStatus(s)
      if (s.status === 'indexed') loadFiles()
    }).catch(() => {})

    const unsub = codr.onIndexerSetupProgress?.((p: { step: string; detail?: string; projectDir?: string; progress?: { current: number; total: number } }) => {
      if (p.projectDir && p.projectDir !== folderPath) return

      if (p.projectDir === folderPath) {
        if (p.step === 'indexing') {
          setIndexingDetail(p.detail || null)
          if (p.progress) setIndexingProgress(p.progress)
        }
        if (p.step === 'indexed' || p.step === 'error') {
          setRebuilding(false)
          setIndexingDetail(null)
          setIndexingProgress(null)
          codr.getIndexerProjectStatus?.(folderPath).then(setProjectStatus).catch(() => {})
          if (p.step === 'indexed') loadFiles()
        }
      } else {
        if (p.step === 'ready' || p.step === 'error') {
          codr.getIndexerStatus?.().then(setGlobalStatus).catch(() => {})
        }
      }
    })
    return () => { unsub?.() }
  }, [folderPath, loadFiles, codr])

  const handleRebuild = () => {
    setRebuilding(true)
    setIndexingDetail(null)
    setIndexingProgress(null)
    codr.rebuildIndex?.(folderPath)
      .then(() => {
        codr.getIndexerProjectStatus?.(folderPath).then(setProjectStatus).catch(() => {})
        loadFiles()
      })
      .catch(() => {})
      .finally(() => setRebuilding(false))
  }

  const handleUpdate = () => {
    setRebuilding(true)
    setIndexingDetail(null)
    setIndexingProgress(null)
    codr.updateIndex?.(folderPath)
      .then(() => {
        codr.getIndexerProjectStatus?.(folderPath).then(setProjectStatus).catch(() => {})
        loadFiles()
      })
      .catch(() => {})
      .finally(() => setRebuilding(false))
  }

  const globalReady = globalStatus.status === 'ready'
  const isIndexed = projectStatus.status === 'indexed'
  const isIndexing = projectStatus.status === 'indexing' || rebuilding

  const statusDot = (() => {
    if (isIndexing) return <div className="w-4 h-4 border-2 border-border border-t-[#6b8dd6] rounded-full animate-[spin_0.8s_linear_infinite]" />
    if (isIndexed) return <span className="w-2.5 h-2.5 rounded-full bg-[#50c878] shrink-0" />
    if (globalStatus.status === 'setting-up') return <span className="w-2.5 h-2.5 rounded-full bg-[#d4a845] animate-pulse shrink-0" />
    if (projectStatus.status === 'error') return <span className="w-2.5 h-2.5 rounded-full bg-[#e06060] shrink-0" />
    return <span className="w-2.5 h-2.5 rounded-full bg-[#e06060] shrink-0" />
  })()

  // Progress bar percentage
  const progressPct = indexingProgress && indexingProgress.total > 0
    ? Math.round((indexingProgress.current / indexingProgress.total) * 100)
    : null

  // File list filtering and language stats
  const filteredFiles = fileFilter
    ? files.filter(f => f.path.toLowerCase().includes(fileFilter.toLowerCase()))
    : files

  const langStats = files.reduce((acc, f) => {
    const lang = f.language || 'unknown'
    acc[lang] = (acc[lang] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  const totalChunks = files.reduce((sum, f) => sum + f.chunkCount, 0)

  return (
    <div>
      {/* Status card */}
      <section className="mb-6">
        <h3 className="m-0 mb-3 text-[13px] font-semibold text-text-faint uppercase tracking-[0.05em]">Project Index</h3>
        <div className="bg-bg-tertiary border border-border-subtle rounded-lg p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-[14px] text-[#e0e0e0] font-medium mb-1">
                {isIndexed && projectStatus.fileCount
                  ? `${projectStatus.fileCount} files indexed`
                  : isIndexing
                    ? 'Indexing...'
                    : globalStatus.status === 'setting-up'
                      ? 'Indexer installing...'
                      : projectStatus.status === 'error'
                        ? 'Index error'
                        : 'Not indexed'}
              </div>
              {isIndexing && indexingDetail && (
                <div className="text-[12px] text-text-faint font-mono overflow-hidden text-ellipsis whitespace-nowrap">{indexingDetail}</div>
              )}
              {!isIndexing && projectStatus.detail && (
                <div className="text-[12px] text-text-faint">{projectStatus.detail}</div>
              )}
              <div className="text-[11px] text-[#555] mt-1 font-mono overflow-hidden text-ellipsis whitespace-nowrap max-w-100">
                {folderPath}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {statusDot}
            </div>
          </div>

          {/* Progress bar during indexing */}
          {isIndexing && progressPct !== null && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-text-faint">
                  {indexingProgress!.current} / {indexingProgress!.total} files
                </span>
                <span className="text-[11px] text-text-faint">{progressPct}%</span>
              </div>
              <div className="h-1.5 bg-[#222] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#6b8dd6] rounded-full transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex gap-2 mt-4 pt-3 border-t border-border-subtle">
            {isIndexed && (
              <button
                className="bg-[#2a2a3d] border border-[#3a3a5a] text-[#ccc] py-1.5 px-3.5 rounded-md text-[12px] cursor-pointer transition-colors duration-150 hover:bg-[#3a3a5a] hover:text-[#e0e0e0] disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleUpdate}
                disabled={isIndexing || !globalReady}
              >
                {isIndexing ? 'Updating...' : 'Update Index'}
              </button>
            )}
            <button
              className="bg-[#2a2a3d] border border-[#3a3a5a] text-[#ccc] py-1.5 px-3.5 rounded-md text-[12px] cursor-pointer transition-colors duration-150 hover:bg-[#3a3a5a] hover:text-[#e0e0e0] disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleRebuild}
              disabled={isIndexing || !globalReady}
            >
              {isIndexing ? 'Rebuilding...' : 'Rebuild Index'}
            </button>
          </div>
        </div>
      </section>

      {/* Stats summary — only when indexed */}
      {isIndexed && files.length > 0 && (
        <section className="mb-6">
          <h3 className="m-0 mb-3 text-[13px] font-semibold text-text-faint uppercase tracking-[0.05em]">Summary</h3>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-bg-tertiary border border-border-subtle rounded-lg px-4 py-3 text-center">
              <div className="text-[18px] font-semibold text-[#e0e0e0]">{files.length}</div>
              <div className="text-[11px] text-text-dim mt-0.5">Files</div>
            </div>
            <div className="bg-bg-tertiary border border-border-subtle rounded-lg px-4 py-3 text-center">
              <div className="text-[18px] font-semibold text-[#e0e0e0]">{totalChunks}</div>
              <div className="text-[11px] text-text-dim mt-0.5">Chunks</div>
            </div>
            <div className="bg-bg-tertiary border border-border-subtle rounded-lg px-4 py-3 text-center">
              <div className="text-[18px] font-semibold text-[#e0e0e0]">{Object.keys(langStats).length}</div>
              <div className="text-[11px] text-text-dim mt-0.5">Languages</div>
            </div>
          </div>
          {/* Language breakdown */}
          <div className="flex flex-wrap gap-2 mt-3">
            {Object.entries(langStats)
              .sort((a, b) => b[1] - a[1])
              .map(([lang, count]) => {
                const info = LANG_LABELS[lang] || LANG_LABELS.unknown
                return (
                  <span key={lang} className="flex items-center gap-1.5 px-2 py-1 bg-bg-tertiary border border-border-subtle rounded text-[11px] text-[#bbb]">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: info.color }} />
                    {info.label} <span className="text-text-dim">{count}</span>
                  </span>
                )
              })}
          </div>
        </section>
      )}

      {/* Indexed files list — expandable */}
      {isIndexed && files.length > 0 && (
        <section className="mb-6">
          <button
            className="flex items-center gap-2 bg-transparent border-0 p-0 cursor-pointer mb-3 group"
            onClick={() => setFilesExpanded(!filesExpanded)}
          >
            <span className="text-[13px] font-semibold text-text-faint uppercase tracking-[0.05em] group-hover:text-[#bbb] transition-colors">
              Indexed Files
            </span>
            <span className="text-text-dim text-[11px] transition-transform" style={{ transform: filesExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
              ▶
            </span>
            <span className="text-[11px] text-[#555]">({files.length})</span>
          </button>

          {filesExpanded && (
            <div className="bg-bg-tertiary border border-border-subtle rounded-lg overflow-hidden">
              {/* Search filter */}
              <div className="px-3 py-2 border-b border-border-subtle">
                <input
                  className="w-full bg-[#141420] border border-border-subtle text-[#e0e0e0] px-2.5 py-1.5 rounded text-[12px] outline-none focus:border-accent placeholder:text-[#555] font-mono"
                  type="text"
                  placeholder="Filter files..."
                  value={fileFilter}
                  onChange={(e) => setFileFilter(e.target.value)}
                />
              </div>

              {/* File list */}
              <div className="max-h-100 overflow-y-auto relative">
                {filteredFiles.length === 0 ? (
                  <div className="text-[12px] text-[#555] italic px-4 py-3">No files match filter</div>
                ) : (
                  filteredFiles.map((file) => {
                    const langInfo = LANG_LABELS[file.language] || LANG_LABELS.unknown
                    return (
                      <div
                        key={file.path}
                        className="flex items-center gap-2 px-3 py-1.5 border-b border-bg-card last:border-b-0 hover:bg-[#222238] cursor-default transition-colors duration-100 group/row"
                        onMouseEnter={(e) => {
                          setHoveredFile(file)
                          const rect = e.currentTarget.getBoundingClientRect()
                          setHoverPos({ x: rect.right - 260, y: rect.top - 4 })
                        }}
                        onMouseLeave={() => setHoveredFile(null)}
                      >
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: langInfo.color }} />
                        <span className="text-[12px] text-[#ccc] font-mono flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                          {file.path}
                        </span>
                        <span className="text-[10px] text-[#555] shrink-0 opacity-0 group-hover/row:opacity-100 transition-opacity">
                          {file.chunkCount > 0 && `${file.chunkCount} chunks`}
                          {file.chunkCount > 0 && file.size > 0 && ' · '}
                          {file.size > 0 && formatFileSize(file.size)}
                        </span>
                      </div>
                    )
                  })
                )}
              </div>

              {filteredFiles.length > 0 && filteredFiles.length < files.length && (
                <div className="text-[11px] text-[#555] px-3 py-2 border-t border-border-subtle">
                  Showing {filteredFiles.length} of {files.length} files
                </div>
              )}
            </div>
          )}

          {/* Hover tooltip */}
          {hoveredFile && filesExpanded && (
            <div
              className="fixed z-100 bg-bg-card border border-[#3a3a5a] rounded-lg p-3 shadow-xl pointer-events-none"
              style={{ top: hoverPos.y, left: hoverPos.x, width: 250, transform: 'translateY(-100%)' }}
            >
              <div className="text-[12px] text-[#e0e0e0] font-mono mb-2 break-all leading-snug">{hoveredFile.path}</div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-text-faint">Language</span>
                  <span className="flex items-center gap-1.5 text-[#ccc]">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: (LANG_LABELS[hoveredFile.language] || LANG_LABELS.unknown).color }} />
                    {(LANG_LABELS[hoveredFile.language] || LANG_LABELS.unknown).label}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-text-faint">Chunks</span>
                  <span className="text-[#ccc]">{hoveredFile.chunkCount}</span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-text-faint">Size</span>
                  <span className="text-[#ccc]">{formatFileSize(hoveredFile.size)}</span>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* About section */}
      <section>
        <h3 className="m-0 mb-3 text-[13px] font-semibold text-text-faint uppercase tracking-[0.05em]">About</h3>
        <div className="text-[12px] text-text-dim leading-relaxed space-y-3">
          <div>
            <h4 className="m-0 mb-1 text-[12px] font-medium text-text-faint">How it works</h4>
            <p className="m-0">
              The project index uses LEANN to perform AST-aware chunking of your source files
              and builds a semantic embedding index with graph-based storage. This powers features like the
              reference finder in the @ menu and automatic codebase context for agents — type a description
              and instantly find the most relevant code.
            </p>
          </div>
          <div>
            <h4 className="m-0 mb-1 text-[12px] font-medium text-text-faint">Supported languages</h4>
            <p className="m-0">TypeScript, JavaScript, Python, Java, C# (AST chunking); all other languages (text chunking)</p>
          </div>
          <div>
            <h4 className="m-0 mb-1 text-[12px] font-medium text-text-faint">Respected ignore files</h4>
            <p className="m-0">
              <span className="font-mono text-[11px]">.gitignore</span>,{' '}
              <span className="font-mono text-[11px]">.codrignore</span>,{' '}
              <span className="font-mono text-[11px]">.cursorignore</span>,{' '}
              <span className="font-mono text-[11px]">.copilotignore</span>,{' '}
              <span className="font-mono text-[11px]">.aiderignore</span>
            </p>
            <p className="m-0 mt-0.5 text-[#555]">Files matched by these patterns are excluded from the index.</p>
          </div>
        </div>
      </section>
    </div>
  )
}
