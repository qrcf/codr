import { useState, useEffect, useRef, useCallback } from 'react'
import type { ChatMessage, ToolCallInfo, AgentMessage, StreamEvent, ToolUseSummaryMessage } from './types'
import { MessageBubble } from './components/MessageBubble'
import { ToolCallBlock } from './components/ToolCallBlock'
import { PermissionDialog } from './components/PermissionDialog'
import { Sidebar } from './components/Sidebar'
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
  const messagesEndRef = useRef<HTMLDivElement>(null)

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

    return () => unsubs.forEach((fn) => fn())
  }, [])

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
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

        <div className="input-bar">
          <textarea
            className="input-field"
            value={input}
            onChange={(e) => setInput(e.target.value)}
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
