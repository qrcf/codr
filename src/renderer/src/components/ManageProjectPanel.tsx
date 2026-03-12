import { useState, useEffect, useRef } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { DiffView } from './DiffView'
import './ManageProjectPanel.css'

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

  return (
    <div className="manage-project-panel">
      <div className="manage-project-header">
        <div className="mp-project-info">
          <div className="mp-project-name">{folderName}</div>
          <div className="mp-project-path">{folderPath}</div>
        </div>
        <button className="btn-close-manage-project" onClick={onClose} title="Close">
          ✕
        </button>
      </div>

      <div className="manage-project-topbar">
        <div className="manage-project-tabs">
          <button className={activeTab === 'general' ? 'active' : ''} onClick={() => setActiveTab('general')}>
            General
          </button>
        </div>
      </div>

      <div className="manage-project-body">
        {activeTab === 'general' && (
          <div>
            {/* CLAUDE.md content */}
            <section className="mp-section">
              <h3 className="mp-section-title">CLAUDE.md</h3>
              {claudeMdLoading ? (
                <div className="mp-claudemd-loading">Loading CLAUDE.md...</div>
              ) : claudeMdContent ? (
                <div className="mp-claudemd-card">
                  <Markdown remarkPlugins={[remarkGfm]}>{claudeMdContent}</Markdown>
                </div>
              ) : (
                <div className="mp-claudemd-card">
                  <div className="mp-claudemd-empty">
                    No CLAUDE.md found in this project. Use the actions below to generate one.
                  </div>
                </div>
              )}
            </section>

            {/* Update actions */}
            {updateState === 'idle' && (
              <section className="mp-section">
                <h3 className="mp-section-title">Update CLAUDE.md</h3>
                <div className="mp-update-actions">
                  <div className="mp-preset-buttons">
                    {PRESET_PROMPTS.map((preset) => (
                      <button
                        key={preset.label}
                        className="mp-preset-btn"
                        onClick={() => triggerUpdate(preset.prompt, preset.label)}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div className="mp-freetext-row">
                    <input
                      className="mp-freetext-input"
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
                      className="mp-freetext-submit"
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
              <section className="mp-section">
                <div className="mp-updating">
                  <div className="mp-spinner" />
                  <span>Claude is working on: {updateLabel}...</span>
                </div>
              </section>
            )}

            {/* Diff review */}
            {updateState === 'reviewing' && proposedContent && (
              <section className="mp-section">
                <div className="mp-diff-section">
                  <div className="mp-diff-header">
                    <h4>Proposed changes</h4>
                    <div className="mp-diff-actions">
                      <button className="mp-btn-accept" onClick={handleAccept}>Accept</button>
                      <button className="mp-btn-reject" onClick={handleReject}>Reject</button>
                    </div>
                  </div>
                  <div className="mp-diff-container">
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
            {error && <div className="mp-error">{error}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
