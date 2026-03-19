import { useState, useRef, useEffect, lazy, Suspense } from 'react'
import { Plus, Square, ChevronDown, Minimize2, CircleCheck, Circle, CircleX, Lightbulb, Code2, MessageCircle } from 'lucide-react'
import { FileMentionDropdown } from '../input/FileMentionDropdown'
import { SlashCommandDropdown } from '../input/SlashCommandDropdown'
import { ModelSelector } from '../input/ModelSelector'
import { useCodr } from '../../hooks/useCodr'

const ReferenceFinderDialog = lazy(() => import('../dialogs/ReferenceFinderDialog').then(m => ({ default: m.ReferenceFinderDialog })))
import { ReasoningSelector, type ReasoningLevel } from '../input/ReasoningSelector'
import { ContextUsageBar } from '../ui/ContextUsageBar'
import { InputAttachmentChips } from '../messages/AttachmentChips'
import { QueuedMessageAccordion } from '../dialogs/QueuedMessageCard'
import type { QueuedMessage } from '../../hooks/useMessageQueue'

interface InputAreaProps {
  // From useInputComposer
  input: string
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  mentionActive: boolean
  mentionQuery: string
  mentionIndex: number
  fileCache: string[]
  selectedFiles: string[]
  setSelectedFiles: React.Dispatch<React.SetStateAction<string[]>>
  selectedDocs: DocSource[]
  setSelectedDocs: React.Dispatch<React.SetStateAction<DocSource[]>>
  attachments: AttachmentMeta[]
  setAttachments: React.Dispatch<React.SetStateAction<AttachmentMeta[]>>
  isDragOver: boolean
  handleInputChange: React.ChangeEventHandler<HTMLTextAreaElement>
  handleMentionSelect: (file: string) => void
  handleDocMentionSelect: (doc: DocSource) => void
  handlePlusClick: () => void
  handleKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement>
  handleDragOver: React.DragEventHandler<HTMLDivElement>
  handleDragLeave: React.DragEventHandler<HTMLDivElement>
  handleDrop: React.DragEventHandler<HTMLDivElement>
  handlePaste: React.ClipboardEventHandler<HTMLTextAreaElement>
  // Reference finder
  refFinderOpen: boolean
  setRefFinderOpen: (open: boolean) => void
  handleFindReferencesSelect: () => void
  handleRefFinderApprove: (files: string[]) => void
  indexerStatus?: string
  projectIndexStatus?: string
  projectFolder: string | null
  // From useDialogs
  mode: 'plan' | 'code' | 'ask'
  setMode: (m: 'plan' | 'code' | 'ask') => void
  autoApproveEdits: boolean
  handleToggleAutoEdits: () => void
  planReady: boolean
  // From useAgentConnection
  isLoading: boolean
  tokenUsage: TokenUsage | null
  // Model
  currentProvider: AgentProviderId
  selectedModel: string | undefined
  onModelChange: (model: string | undefined) => Promise<void>
  // Reasoning
  reasoning: ReasoningLevel
  onReasoningChange: (level: ReasoningLevel) => void
  // Actions
  activeSessionId: string | null
  onSend: () => void
  onInterrupt: () => void
  onCompact: () => void
  // Slash commands
  slashActive: boolean
  filteredSlashCommands: SlashCommand[]
  slashIndex: number
  handleSlashSelect: (cmd: SlashCommand) => void
  // Docs
  docSources: DocSource[]
  // Queue
  queuedMessages: QueuedMessage[]
  onRemoveQueued: (id: string) => void
  onSendQueued: (id: string) => void
  onEditQueued: (id: string) => void
}

const MODE_CONFIG = {
  plan: { icon: Lightbulb, color: '#f5c542', bg: 'rgba(245,197,66,0.08)', label: 'Plan' },
  code: { icon: Code2,    color: '#8142c7', bg: 'rgba(129,66,199,0.08)', label: 'Code' },
  ask:  { icon: MessageCircle, color: '#34d399', bg: 'rgba(52,211,153,0.08)', label: 'Ask'  },
} as const

export function InputArea({
  input,
  textareaRef,
  mentionActive,
  mentionQuery,
  mentionIndex,
  fileCache,
  selectedFiles,
  setSelectedFiles,
  selectedDocs,
  setSelectedDocs,
  attachments,
  setAttachments,
  isDragOver,
  handleInputChange,
  handleMentionSelect,
  handleDocMentionSelect,
  handlePlusClick,
  handleKeyDown,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  handlePaste,
  refFinderOpen,
  setRefFinderOpen,
  handleFindReferencesSelect,
  handleRefFinderApprove,
  indexerStatus,
  projectIndexStatus,
  projectFolder,
  mode,
  setMode,
  autoApproveEdits,
  handleToggleAutoEdits,
  // planReady — reserved for future use
  isLoading,
  tokenUsage,
  currentProvider,
  selectedModel,
  onModelChange,
  reasoning,
  onReasoningChange,
  activeSessionId,
  onSend,
  onInterrupt,
  onCompact,
  slashActive,
  filteredSlashCommands,
  slashIndex,
  handleSlashSelect,
  docSources,
  queuedMessages,
  onRemoveQueued,
  onSendQueued,
  onEditQueued,
}: InputAreaProps) {
  const codr = useCodr()
  const [modeOpen, setModeOpen] = useState(false)
  const modeRef = useRef<HTMLDivElement>(null)
  const [compactConfirmOpen, setCompactConfirmOpen] = useState(false)
  const [hasReasoningControl, setHasReasoningControl] = useState(true)

  useEffect(() => {
    codr.getProviderCapabilities?.()
      .then(caps => {
        if (caps?.[currentProvider]) {
          setHasReasoningControl(caps[currentProvider].includes('reasoning-control'))
        }
      })
      .catch(() => {})
  }, [currentProvider, codr])

  useEffect(() => {
    return codr.onCapabilitiesChanged?.((data) => {
      if (data.providerId === currentProvider) {
        setHasReasoningControl(data.capabilities.includes('reasoning-control'))
      }
    })
  }, [currentProvider, codr])
  const compactRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!modeOpen) return
    const handler = (e: MouseEvent) => {
      if (modeRef.current && !modeRef.current.contains(e.target as Node)) setModeOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [modeOpen])

  useEffect(() => {
    if (!compactConfirmOpen) return
    const handler = (e: MouseEvent) => {
      if (compactRef.current && !compactRef.current.contains(e.target as Node)) setCompactConfirmOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [compactConfirmOpen])

  const isRealSession = activeSessionId && !activeSessionId.startsWith('draft-')

  return (
    <div
      className="px-4 py-3 shrink-0 max-w-205 w-full mx-auto box-border max-[768px]:max-w-full max-[768px]:px-3 max-[768px]:py-2"
      style={{ position: 'relative' }}
    >
      {slashActive && filteredSlashCommands.length > 0 && (
        <SlashCommandDropdown
          commands={filteredSlashCommands}
          activeIndex={slashIndex}
          onSelect={handleSlashSelect}
        />
      )}
      {mentionActive && (
        <FileMentionDropdown
          files={fileCache}
          docSources={docSources}
          query={mentionQuery}
          activeIndex={mentionIndex}
          onSelect={handleMentionSelect}
          onSelectDoc={handleDocMentionSelect}
          onFindReferences={handleFindReferencesSelect}
          indexerStatus={indexerStatus}
          projectIndexStatus={projectIndexStatus}
        />
      )}
      <Suspense fallback={null}>
        <ReferenceFinderDialog
          key={`${projectFolder ?? 'no-project'}:${refFinderOpen ? 'open' : 'closed'}`}
          isOpen={refFinderOpen}
          onClose={() => setRefFinderOpen(false)}
          onApprove={handleRefFinderApprove}
          projectFolder={projectFolder}
          currentSelectedFiles={selectedFiles}
          indexerStatus={indexerStatus}
        />
      </Suspense>
      {/* Queued messages */}
      {queuedMessages.length > 0 && (
        <QueuedMessageAccordion
          messages={queuedMessages}
          onSendNow={onSendQueued}
          onEdit={onEditQueued}
          onRemove={onRemoveQueued}
        />
      )}

      <div
        className={`flex flex-col rounded-xl border transition-[border-color,background] duration-150 ${isDragOver ? 'border-accent bg-accent/6' : 'border-border bg-bg-tertiary'}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Chips row */}
        {(selectedFiles.length > 0 || selectedDocs.length > 0 || attachments.length > 0) && (
          <div className="flex flex-wrap gap-1 px-3 pt-2">
            {selectedDocs.map(doc => (
              <span key={`doc-${doc.id}`} className="inline-flex items-center gap-1 bg-[#3a5a44] text-[#ccc] px-2 py-0.5 rounded text-[0.82em]">
                <span title={doc.url}>📄 {doc.name}</span>
                <button className="bg-transparent border-none text-text-muted cursor-pointer px-0.5 py-0 text-[12px] leading-none hover:text-white"
                  onClick={() => setSelectedDocs(prev => prev.filter(d => d.id !== doc.id))}
                >×</button>
              </span>
            ))}
            {selectedFiles.map(file => (
              <span key={file} className="inline-flex items-center gap-1 bg-[#444460] text-[#ccc] px-2 py-0.5 rounded text-[0.82em] font-['SF_Mono','Fira_Code',monospace]">
                <span title={file}>{file.startsWith('/') ? file.split('/').pop() : file}</span>
                <button className="bg-transparent border-none text-text-muted cursor-pointer px-0.5 py-0 text-[12px] leading-none hover:text-white"
                  onClick={() => setSelectedFiles(prev => prev.filter(f => f !== file))}
                >×</button>
              </span>
            ))}
            <InputAttachmentChips
              attachments={attachments}
              onRemove={(id) => setAttachments(prev => prev.filter(a => a.id !== id))}
            />
          </div>
        )}

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          className="w-full bg-transparent border-none px-3 py-3 text-inherit font-[inherit] text-[0.95em] resize-none leading-normal min-h-11 max-h-60 overflow-y-hidden focus:outline-none"
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Send a message... (@ for files)"
          rows={1}
        />

        {/* Bottom toolbar */}
        <div className="flex items-center justify-between px-2 pb-2 gap-2">
          {/* Left: + and Mode */}
          <div className="flex items-center gap-1.25">
            {/* + attach */}
            <button
              className="w-7 h-7 inline-flex items-center justify-center rounded-md text-text-faint bg-transparent border-none cursor-pointer transition-all duration-150 hover:text-accent hover:bg-white/4 disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={handlePlusClick}
              title="Attach file (@)"
            >
              <Plus size={13} />
            </button>

            {/* Mode dropdown */}
            <div className="relative" ref={modeRef}>
              {(() => {
                const cfg = MODE_CONFIG[mode]
                const Icon = cfg.icon
                return (
                  <button
                    className="inline-flex items-center gap-1.25 rounded-md px-2 py-0.75 text-[0.78rem] cursor-pointer transition-all duration-150 border-none"
                    style={{ color: cfg.color, background: modeOpen ? cfg.bg : 'transparent' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = cfg.bg }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = modeOpen ? cfg.bg : 'transparent' }}
                    onClick={() => setModeOpen(prev => !prev)}
                  >
                    <Icon size={12} />
                    <span>{cfg.label}</span>
                    <ChevronDown size={10} className={`transition-transform duration-150 opacity-60 ${modeOpen ? 'rotate-180' : ''}`} />
                  </button>
                )
              })()}
              {modeOpen && (
                <div className="absolute bottom-full left-0 mb-1 min-w-27.5 bg-[#1a1a2e] border border-[#2e2e44] rounded-lg py-1 z-10 shadow-[0_4px_16px_rgba(0,0,0,0.5)]">
                  {(['plan', 'code', 'ask'] as const).map((m) => {
                    const cfg = MODE_CONFIG[m]
                    const Icon = cfg.icon
                    return (
                      <button
                        key={m}
                        className="w-full flex items-center gap-2 px-3 py-1.75 text-[0.8em] border-none cursor-pointer transition-colors duration-100"
                        style={{
                          background: mode === m ? cfg.bg : 'transparent',
                          color: mode === m ? cfg.color : '#888',
                        }}
                        onMouseEnter={e => { if (mode !== m) (e.currentTarget as HTMLElement).style.color = cfg.color; (e.currentTarget as HTMLElement).style.background = cfg.bg }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = mode === m ? cfg.color : '#888'; (e.currentTarget as HTMLElement).style.background = mode === m ? cfg.bg : 'transparent' }}
                        onClick={() => { setMode(m); setModeOpen(false) }}
                      >
                        <Icon size={12} />
                        <span>{cfg.label}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right: Model, Reasoning, Send/Stop */}
          <div className="flex items-center gap-1.25 shrink-0">
            {/* Model */}
            <ModelSelector
              provider={currentProvider}
              selectedModel={selectedModel}
              onModelChange={onModelChange}
              disabled={isLoading}
            />

            {/* Reasoning */}
            {hasReasoningControl && (
              <ReasoningSelector
                value={reasoning}
                onChange={onReasoningChange}
                disabled={isLoading}
              />
            )}

            {/* Send / Stop */}
            {isLoading ? (
              <div className="flex items-center gap-1">
                <button
                  className="w-8 h-8 inline-flex items-center justify-center rounded-lg bg-accent text-white shadow-[0_1px_3px_rgba(129,66,199,0.35),inset_0_1px_0_rgba(255,255,255,0.1)] cursor-pointer transition-all duration-150 enabled:hover:bg-accent-hover enabled:hover:shadow-[0_2px_6px_rgba(129,66,199,0.45)] disabled:opacity-40 disabled:cursor-not-allowed"
                  onClick={onSend}
                  disabled={!input.trim() && selectedFiles.length === 0 && selectedDocs.length === 0 && attachments.length === 0}
                  title="Queue message"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="5 12 12 5 19 12" />
                  </svg>
                </button>
                <button
                  className="w-8 h-8 inline-flex items-center justify-center rounded-lg bg-[#3e3e50] border border-[#555] text-[#ccc] cursor-pointer transition-all duration-150 hover:bg-[#4a3a3a] hover:border-[#c0392b] hover:text-[#e74c3c]"
                  onClick={onInterrupt}
                >
                  <Square size={13} />
                </button>
              </div>
            ) : (
              <button
                className="w-8 h-8 inline-flex items-center justify-center rounded-lg bg-accent text-white shadow-[0_1px_3px_rgba(129,66,199,0.35),inset_0_1px_0_rgba(255,255,255,0.1)] cursor-pointer transition-all duration-150 enabled:hover:bg-accent-hover enabled:hover:shadow-[0_2px_6px_rgba(129,66,199,0.45)] disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={onSend}
                disabled={!input.trim() && selectedFiles.length === 0 && selectedDocs.length === 0 && attachments.length === 0}
                title="Send"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Below-card row: allow/ask toggle left, context + compact right */}
      <div className="flex items-center justify-between px-1 pt-1 min-h-6">
        {/* Left: Allow/Ask/Deny edits toggle */}
        <div className="group relative">
          {mode === 'ask' ? (
            <button
              className="inline-flex items-center gap-1.25 rounded-md px-1.5 py-0.5 text-[0.75rem] cursor-pointer bg-transparent border-none transition-all duration-150 hover:bg-white/4 text-[#555]"
              onClick={handleToggleAutoEdits}
            >
              <CircleX size={12} className="shrink-0" />
              <span>Deny</span>
            </button>
          ) : (
            <button
              className="inline-flex items-center gap-1.25 rounded-md px-1.5 py-0.5 text-[0.75rem] cursor-pointer bg-transparent border-none transition-all duration-150 hover:bg-white/4"
              onClick={handleToggleAutoEdits}
            >
              {autoApproveEdits
                ? <CircleCheck size={12} className="text-success shrink-0" />
                : <Circle size={12} className="text-[#f5a623] shrink-0" />
              }
              <span className={autoApproveEdits ? 'text-success' : 'text-[#f5a623]'}>
                {autoApproveEdits ? 'Allow' : 'Ask'}
              </span>
            </button>
          )}
          <div className="hidden group-hover:block absolute bottom-[calc(100%+8px)] left-0 bg-bg-card border border-white/10 rounded-lg px-3 py-2 text-[0.7rem] text-[#ccc] whitespace-nowrap z-100 shadow-[0_4px_12px_rgba(0,0,0,0.3)] pointer-events-none">
            {mode === 'ask'
              ? <><span className="text-[#555] font-medium">Deny</span> — Ask mode: file edits are blocked</>
              : autoApproveEdits
                ? <><span className="text-success font-medium">Allow</span> — File edits are auto-approved</>
                : <><span className="text-[#f5a623] font-medium">Ask</span> — Claude will ask before editing files</>
            }
          </div>
        </div>

        {/* Right: context usage + compact */}
        {isRealSession && (
          <div className="flex items-center gap-1">
            {tokenUsage && <ContextUsageBar {...tokenUsage} />}
            <div className="group relative" ref={compactRef}>
              <button
                className="w-6 h-6 inline-flex items-center justify-center rounded-md bg-transparent border-none cursor-pointer transition-all duration-150 enabled:hover:text-accent enabled:hover:bg-white/4 disabled:opacity-40 disabled:cursor-not-allowed text-[#555] hover:text-text-faint"
                onClick={() => setCompactConfirmOpen(prev => !prev)}
                disabled={isLoading}
              >
                <Minimize2 size={12} />
              </button>
              {!compactConfirmOpen && (
                <div className="hidden group-hover:block absolute bottom-[calc(100%+8px)] right-0 bg-bg-card border border-white/10 rounded-lg px-3 py-2 text-[0.7rem] text-[#ccc] whitespace-nowrap z-100 shadow-[0_4px_12px_rgba(0,0,0,0.3)] pointer-events-none">
                  <span className="font-medium text-[#aaa]">Compact</span> — summarize history to free up context
                </div>
              )}
              {compactConfirmOpen && (
                <div className="absolute bottom-full right-0 mb-2 bg-bg-card border border-border rounded-lg px-3 py-2.5 z-20 shadow-[0_4px_16px_rgba(0,0,0,0.5)] w-50">
                  <p className="text-[0.78rem] text-[#ccc] mb-2.5 leading-snug">Compact conversation history?</p>
                  <div className="flex gap-2">
                    <button
                      className="flex-1 bg-accent text-white border-none rounded-md py-1 text-[0.75rem] cursor-pointer hover:bg-accent-hover transition-colors duration-150"
                      onClick={() => { setCompactConfirmOpen(false); onCompact() }}
                    >
                      Compact
                    </button>
                    <button
                      className="flex-1 bg-transparent text-text-faint border border-[#444] rounded-md py-1 text-[0.75rem] cursor-pointer hover:text-white hover:border-text-dim transition-colors duration-150"
                      onClick={() => setCompactConfirmOpen(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
