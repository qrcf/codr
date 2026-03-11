import { useState, useEffect, useRef, useCallback } from 'react'
import type { ChatMessage, ToolCallInfo, AgentMessage, StreamEvent, ToolUseSummaryMessage } from './types'
import { MessageBubble } from './components/MessageBubble'
import { ToolCallBlock } from './components/ToolCallBlock'
import { PermissionDialog } from './components/PermissionDialog'
import { Sidebar } from './components/Sidebar'
import { FileMentionDropdown } from './components/FileMentionDropdown'
import './App.css'

let messageIdCounter = 0
function nextId() {
  return `msg-${++messageIdCounter}`
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [streamingTools, setStreamingTools] = useState<ToolCallInfo[]>([])
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null)
  const [autoApproveEdits, setAutoApproveEdits] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    return localStorage.getItem('sidebar-open') !== 'false'
  })
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [mentionActive, setMentionActive] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionStart, setMentionStart] = useState(0)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [fileCache, setFileCache] = useState<string[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(scrollToBottom, [messages, streamingText, streamingTools, scrollToBottom])

  useEffect(() => {
    const unsubs: Array<() => void> = []

    unsubs.push(window.claude.onMessage((raw) => {
      const msg = raw as AgentMessage
      switch (msg.type) {
        case 'stream_event': {
          const evt = msg as StreamEvent
          if (evt.event.type === 'content_block_delta' && evt.event.delta?.type === 'text_delta' && evt.event.delta.text) {
            setStreamingText((prev) => prev + evt.event.delta!.text!)
          }
          break
        }
        case 'tool_use_summary': {
          const tool = msg as ToolUseSummaryMessage
          const toolInfo: ToolCallInfo = {
            id: `tool-${Date.now()}-${Math.random()}`,
            name: tool.tool_name,
            input: tool.tool_input,
            result: tool.tool_result,
            isError: tool.is_error,
            status: tool.is_error ? 'error' : 'done',
          }
          setStreamingTools((prev) => [...prev, toolInfo])
          break
        }
      }
    }))

    unsubs.push(window.claude.onError((error) => {
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'assistant', content: `Error: ${error}`, toolCalls: [] },
      ])
      setIsLoading(false)
      setStreamingText('')
      setStreamingTools([])
    }))

    unsubs.push(window.claude.onDone(() => {
      setStreamingText((text) => {
        setStreamingTools((tools) => {
          if (text || tools.length > 0) {
            setMessages((prev) => [
              ...prev,
              { id: nextId(), role: 'assistant', content: text, toolCalls: tools },
            ])
          }
          return []
        })
        return ''
      })
      setIsLoading(false)
    }))

    unsubs.push(window.claude.onPermissionRequest((request) => {
      setPermissionRequest(request)
    }))

    // State sync (web client only — replaces state when joining mid-conversation)
    if (window.claude.onStateSync) {
      unsubs.push(window.claude.onStateSync((state) => {
        setMessages(state.messages)
        setIsLoading(state.isLoading)
        setStreamingText(state.streamingText)
        setStreamingTools(state.streamingTools)
        setPermissionRequest(state.permissionRequest)
      }))
    }

    return () => unsubs.forEach((fn) => fn())
  }, [])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    const clamped = Math.min(ta.scrollHeight, 240)
    ta.style.height = clamped + 'px'
    ta.style.overflowY = ta.scrollHeight > 240 ? 'auto' : 'hidden'
  }, [input])

  const handleSend = async () => {
    const prompt = input.trim()
    if (!prompt || isLoading) return

    setInput('')
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: 'user', content: prompt, toolCalls: [] },
    ])
    setIsLoading(true)
    setStreamingText('')
    setStreamingTools([])

    await window.claude.query(
      prompt,
      activeSessionId ? { resumeSessionId: activeSessionId } : undefined,
    )
  }

  const handleInterrupt = () => {
    window.claude.interrupt()
  }

  const handlePermissionResponse = (id: number, allowed: boolean) => {
    window.claude.respondPermission(id, allowed)
    setPermissionRequest(null)
  }

  const handleToggleAutoEdits = () => {
    const next = !autoApproveEdits
    setAutoApproveEdits(next)
    window.claude.updateSettings({ autoApproveEdits: next })
  }

  const toggleSidebar = () => {
    setSidebarOpen((prev) => {
      const next = !prev
      localStorage.setItem('sidebar-open', String(next))
      return next
    })
  }

  const handleLoadSession = (sessionId: string, sessionMessages: ChatMessage[]) => {
    setMessages(sessionMessages)
    setActiveSessionId(sessionId)
    setStreamingText('')
    setStreamingTools([])
  }

  const handleNewChat = () => {
    setMessages([])
    setActiveSessionId(null)
    setStreamingText('')
    setStreamingTools([])
    setInput('')
  }

  const getFilteredFiles = useCallback(() => {
    const q = mentionQuery.toLowerCase()
    const filtered = q ? fileCache.filter((f) => f.toLowerCase().includes(q)) : fileCache
    return filtered.slice(0, 15)
  }, [fileCache, mentionQuery])

  const handleMentionSelect = useCallback((file: string) => {
    const before = input.slice(0, mentionStart)
    const after = input.slice(mentionStart + mentionQuery.length + 1)
    setInput(before + '@' + file + ' ' + after)
    setMentionActive(false)
    setMentionQuery('')
    setMentionIndex(0)
    textareaRef.current?.focus()
  }, [input, mentionStart, mentionQuery])

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    const cursor = e.target.selectionStart
    setInput(value)

    // Check for @ mention trigger
    if (mentionActive) {
      // Find the @ that started this mention
      const textAfterAt = value.slice(mentionStart + 1, cursor)
      if (textAfterAt.includes(' ') || textAfterAt.includes('\n') || cursor <= mentionStart) {
        setMentionActive(false)
        setMentionQuery('')
        setMentionIndex(0)
      } else {
        setMentionQuery(textAfterAt)
        setMentionIndex(0)
      }
    } else {
      // Detect new @ trigger
      const charBeforeCursor = value[cursor - 1]
      const charBeforeAt = value[cursor - 2]
      if (charBeforeCursor === '@' && (cursor === 1 || charBeforeAt === ' ' || charBeforeAt === '\n' || charBeforeAt === undefined)) {
        setMentionActive(true)
        setMentionStart(cursor - 1)
        setMentionQuery('')
        setMentionIndex(0)
        if (fileCache.length === 0) {
          window.claude.listFiles().then(setFileCache).catch(() => {})
        }
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionActive) {
      const filtered = getFilteredFiles()
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex((i) => Math.min(i + 1, filtered.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        if (filtered.length > 0) {
          handleMentionSelect(filtered[mentionIndex])
        }
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMentionActive(false)
        setMentionQuery('')
        setMentionIndex(0)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="app-shell">
      <Sidebar
        isOpen={sidebarOpen}
        activeSessionId={activeSessionId}
        isLoading={isLoading}
        autoApproveEdits={autoApproveEdits}
        onLoadSession={handleLoadSession}
        onNewChat={handleNewChat}
        onToggleAutoEdits={handleToggleAutoEdits}
      />

      <div className="app">
        <header className="app-header">
          <button className="btn-toggle-sidebar" onClick={toggleSidebar}>
            {sidebarOpen ? '◀' : '▶'}
          </button>
          <h1>Coder</h1>
        </header>

        <div className="messages-container">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {isLoading && (streamingText || streamingTools.length > 0) && (
            <div className="message message-assistant">
              <div className="message-role">Claude</div>
              {streamingText && <div className="message-content">{streamingText}</div>}
              {streamingTools.length > 0 && (
                <div className="tool-calls">
                  {streamingTools.map((tool) => (
                    <ToolCallBlock key={tool.id} tool={tool} />
                  ))}
                </div>
              )}
            </div>
          )}

          {isLoading && !streamingText && streamingTools.length === 0 && (
            <div className="message message-assistant">
              <div className="message-role">Claude</div>
              <div className="message-content thinking">Thinking...</div>
            </div>
          )}

          {permissionRequest && (
            <PermissionDialog request={permissionRequest} onRespond={handlePermissionResponse} />
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="input-bar" style={{ position: 'relative' }}>
          {mentionActive && (
            <FileMentionDropdown
              files={fileCache}
              query={mentionQuery}
              activeIndex={mentionIndex}
              onSelect={handleMentionSelect}
            />
          )}
          <textarea
            ref={textareaRef}
            className="input-field"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Send a message..."
            rows={1}
            disabled={isLoading}
          />
          {isLoading ? (
            <button className="btn btn-interrupt" onClick={handleInterrupt}>Stop</button>
          ) : (
            <button className="btn btn-send" onClick={handleSend} disabled={!input.trim()}>Send</button>
          )}
        </div>
      </div>
    </div>
  )
}
