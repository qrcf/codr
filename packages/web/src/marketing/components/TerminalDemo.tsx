import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, useInView } from 'motion/react'
import { ChevronRight } from 'lucide-react'

const PROMPT = 'Add dark mode support to the settings panel'
const RESPONSE_TEXT = "I'll add a dark mode toggle to the settings panel with system, light, and dark options. Let me read the current component and set up the theme system."
const TOOLS_SUMMARY = 'Read 2 files, edited 3 files, wrote 1 file'
const FINAL_TEXT = 'Done. Dark mode toggle added to Settings \u2192 General. It defaults to your system preference and persists the choice to localStorage.'

type Phase = 'idle' | 'typing' | 'sent' | 'thinking' | 'response' | 'tools' | 'final' | 'done'

export default function TerminalDemo() {
  const ref = useRef<HTMLDivElement>(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })
  const [phase, setPhase] = useState<Phase>('idle')
  const [charIndex, setCharIndex] = useState(0)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const schedule = useCallback((fn: () => void, ms: number) => {
    timerRef.current = setTimeout(fn, ms)
  }, [])

  // Start animation when in view
  useEffect(() => {
    if (!isInView) return
    schedule(() => setPhase('typing'), 600)
    return () => clearTimeout(timerRef.current)
  }, [isInView, schedule])

  // Drive phase transitions
  useEffect(() => {
    if (phase === 'typing') {
      if (charIndex < PROMPT.length) {
        const delay = 30 + Math.random() * 25
        timerRef.current = setTimeout(() => setCharIndex(i => i + 1), delay)
      } else {
        schedule(() => setPhase('sent'), 500)
      }
    } else if (phase === 'sent') {
      schedule(() => setPhase('thinking'), 100)
    } else if (phase === 'thinking') {
      schedule(() => setPhase('response'), 1200)
    } else if (phase === 'response') {
      schedule(() => setPhase('tools'), 800)
    } else if (phase === 'tools') {
      schedule(() => setPhase('final'), 600)
    } else if (phase === 'final') {
      schedule(() => setPhase('done'), 400)
    }
    return () => clearTimeout(timerRef.current)
  }, [phase, charIndex, schedule])

  const showUserBubble = phase !== 'idle' && phase !== 'typing'
  const showThinking = phase === 'thinking'
  const showResponse = ['response', 'tools', 'final', 'done'].includes(phase)
  const showTools = ['tools', 'final', 'done'].includes(phase)
  const showFinal = ['final', 'done'].includes(phase)
  const showInputCursor = phase === 'idle' || phase === 'typing' || phase === 'done'
  const typedText = phase === 'typing' ? PROMPT.slice(0, charIndex) : ''

  return (
    <section className="mk-demo" id="demo">
      <div className="mk-container">
        <motion.div
          className="mk-demo__header"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.5 }}
        >
          <h2 className="mk-demo__title">See it in action</h2>
          <p className="mk-demo__subtitle">
            Describe what you want. Codr handles the rest.
          </p>
        </motion.div>

        <motion.div
          ref={ref}
          className="mk-appdemo"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.6 }}
        >
          {/* Window chrome */}
          <div className="mk-appdemo__bar">
            <span className="mk-appdemo__dot mk-appdemo__dot--red" />
            <span className="mk-appdemo__dot mk-appdemo__dot--yellow" />
            <span className="mk-appdemo__dot mk-appdemo__dot--green" />
            <span className="mk-appdemo__bar-title">codr</span>
          </div>

          {/* Header */}
          <div className="mk-appdemo__app-header">
            <span className="mk-appdemo__project">my-project</span>
            <span className="mk-appdemo__session-name">Add dark mode support</span>
          </div>

          {/* Messages */}
          <div className="mk-appdemo__messages">
            {showUserBubble && (
              <motion.div
                className="mk-appdemo__msg mk-appdemo__msg--user"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                <div className="mk-appdemo__bubble">{PROMPT}</div>
              </motion.div>
            )}

            {showThinking && (
              <motion.div
                className="mk-appdemo__msg mk-appdemo__msg--assistant"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
              >
                <div className="mk-appdemo__loading">
                  <div className="mk-appdemo__spinner" />
                  <span>Thinking...</span>
                </div>
              </motion.div>
            )}

            {showResponse && (
              <motion.div
                className="mk-appdemo__msg mk-appdemo__msg--assistant"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                <div className="mk-appdemo__text">{RESPONSE_TEXT}</div>

                {showTools && (
                  <motion.div
                    className="mk-appdemo__tool-group"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    <ChevronRight size={10} className="mk-appdemo__tool-chevron" />
                    <span className="mk-appdemo__tool-summary">{TOOLS_SUMMARY}</span>
                  </motion.div>
                )}

                {showFinal && (
                  <motion.div
                    className="mk-appdemo__text"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    {FINAL_TEXT}
                  </motion.div>
                )}

                {!showFinal && showTools && (
                  <div className="mk-appdemo__loading">
                    <div className="mk-appdemo__spinner" />
                    <span>Working...</span>
                  </div>
                )}
              </motion.div>
            )}
          </div>

          {/* Input bar */}
          <div className="mk-appdemo__input-area">
            <div className="mk-appdemo__input-field">
              {typedText ? (
                <span className="mk-appdemo__input-text">
                  {typedText}
                  <span className="mk-appdemo__cursor" />
                </span>
              ) : showInputCursor ? (
                <span className="mk-appdemo__cursor" />
              ) : (
                <span className="mk-appdemo__input-placeholder">Send a message...</span>
              )}
            </div>
            <div className="mk-appdemo__input-toolbar">
              <div className="mk-appdemo__toolbar-left">
                <div className="mk-appdemo__modes">
                  <span className="mk-appdemo__mode">Plan</span>
                  <span className="mk-appdemo__mode mk-appdemo__mode--active">Code</span>
                  <span className="mk-appdemo__mode mk-appdemo__mode--last">Ask</span>
                </div>
                <label className="mk-appdemo__allow">
                  <span className="mk-appdemo__allow-track">
                    <span className="mk-appdemo__allow-thumb" />
                  </span>
                  <span>Allow edits</span>
                </label>
              </div>
              <span className="mk-appdemo__send">Send</span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
