import { useState, useEffect, useRef } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { DiffView } from './DiffView'

interface ManageProjectPanelProps {
  folderPath: string
  onClose: () => void
}

type Tab = 'general'
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
  }, [folderPath])

  async function loadClaudeMd() {
    setClaudeMdLoading(true)
    setError(null)
    try {
      const result = await window.claude.readClaudeMd?.(folderPath)
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
    const unsubMessage = window.claude.onMessage((message: unknown) => {
      const msg = message as { type?: string; message?: { content?: Array<{ type?: string; text?: string }> } }
      if (msg?.type === 'assistant' && msg?.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text) {
            collectedResponseRef.current = block.text
          }
        }
      }
    })

    const unsubDone = window.claude.onDone(() => {
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

    const unsubError = window.claude.onError((err: string) => {
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
    window.claude.query(fullPrompt, { cwd: folderPath }).catch((err) => {
      cleanup()
      setError(String(err))
      setUpdateState('idle')
    })
  }

  async function handleAccept() {
    if (!proposedContent) return
    setError(null)
    try {
      const result = await window.claude.writeClaudeMd?.(folderPath, proposedContent)
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
        ? 'text-[#e0e0e0] border-b-[#8142c7]'
        : 'text-[#888] border-b-transparent hover:text-[#ccc]'
    }`

  return (
    <div className="flex flex-col flex-1 h-screen min-w-0 bg-[#121218]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 shrink-0">
        <div className="min-w-0">
          <div className="text-[18px] font-semibold text-[#e0e0e0] overflow-hidden text-ellipsis whitespace-nowrap">{folderName}</div>
          <div className="text-[12px] text-[#666] mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">{folderPath}</div>
        </div>
        <button
          className="bg-transparent border border-[#333] text-[#888] w-8 h-8 rounded-md cursor-pointer flex items-center justify-center text-[16px] transition-colors duration-150 shrink-0 hover:bg-[#2a2a3a] hover:text-[#ccc]"
          onClick={onClose}
          title="Close"
        >
          ✕
        </button>
      </div>

      {/* Topbar / Tabs */}
      <div className="flex items-center px-4 border-b border-[#2a2a3a] shrink-0">
        <div className="flex gap-0">
          <button className={tabBtnClass(activeTab === 'general')} onClick={() => setActiveTab('general')}>
            General
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 px-8 py-6 overflow-y-auto text-[#bbb] text-[14px] max-sm:px-4">
        {activeTab === 'general' && (
          <div>
            {/* CLAUDE.md content */}
            <section className="mb-8">
              <h3 className="m-0 mb-3 text-[13px] font-semibold text-[#888] uppercase tracking-[0.05em]">CLAUDE.md</h3>
              {claudeMdLoading ? (
                <div className="text-[#666] italic">Loading CLAUDE.md...</div>
              ) : claudeMdContent ? (
                <div className="mp-claudemd-card bg-[#1a1a2a] border border-[#2a2a3a] rounded-lg px-6 py-5 max-h-[50vh] overflow-y-auto">
                  <Markdown remarkPlugins={[remarkGfm]}>{claudeMdContent}</Markdown>
                </div>
              ) : (
                <div className="mp-claudemd-card bg-[#1a1a2a] border border-[#2a2a3a] rounded-lg px-6 py-5 max-h-[50vh] overflow-y-auto">
                  <div className="text-[#666] italic px-6 py-6 text-center">
                    No CLAUDE.md found in this project. Use the actions below to generate one.
                  </div>
                </div>
              )}
            </section>

            {/* Update actions */}
            {updateState === 'idle' && (
              <section className="mb-8">
                <h3 className="m-0 mb-3 text-[13px] font-semibold text-[#888] uppercase tracking-[0.05em]">Update CLAUDE.md</h3>
                <div className="mt-4">
                  <div className="flex flex-wrap gap-2 mb-3">
                    {PRESET_PROMPTS.map((preset) => (
                      <button
                        key={preset.label}
                        className="bg-[#2a2a3d] border border-[#3a3a5a] text-[#ccc] px-3.5 py-[7px] rounded-md cursor-pointer text-[13px] transition-colors duration-150 hover:bg-[#3a3a5a] hover:text-[#e0e0e0] hover:border-[#8142c7] disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => triggerUpdate(preset.prompt, preset.label)}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      className="flex-1 bg-[#1a1a2a] border border-[#2a2a3a] text-[#e0e0e0] px-3 py-2 rounded-md text-[13px] outline-none transition-colors duration-150 focus:border-[#8142c7] placeholder:text-[#555]"
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
                      className="bg-[#8142c7] border-none text-white px-[18px] py-2 rounded-md cursor-pointer text-[13px] font-medium transition-colors duration-150 whitespace-nowrap hover:bg-[#9656d8] disabled:opacity-50 disabled:cursor-not-allowed"
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
                <div className="flex items-center gap-2.5 text-[#888] italic py-4">
                  <div className="w-4 h-4 border-2 border-[#333] border-t-[#8142c7] rounded-full animate-[spin_0.8s_linear_infinite]" />
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
                        className="bg-[#1a1a2a] border border-[#333] text-[#888] px-4 py-1.5 rounded-md cursor-pointer text-[13px] transition-colors duration-150 hover:bg-[#2a2a3a] hover:text-[#ccc]"
                        onClick={handleReject}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                  <div className="bg-[#0e0e16] border border-[#2a2a3a] rounded-lg p-3 max-h-[50vh] overflow-y-auto">
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
      </div>
    </div>
  )
}
