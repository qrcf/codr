import type { BrowserWindow } from 'electron'
import type { RelayClient } from './relay-client'
import type { ChatMessage, ToolCallInfo } from './types'

// Map IPC channel names to relay WebSocket message types
const CHANNEL_TO_WS_TYPE: Record<string, string> = {
  'agent:message': 'agent_message',
  'agent:error': 'agent_error',
  'agent:done': 'agent_done',
  'agent:permission-request': 'permission_request',
  'sessions:refresh-hint': 'sessions_refresh_hint',
}

export interface ConversationState {
  messages: ChatMessage[]
  isLoading: boolean
  streamingText: string
  streamingTools: ToolCallInfo[]
  permissionRequest: { id: number; tool: string; input: unknown } | null
}

export class EventBroadcaster {
  private getMainWindow: () => BrowserWindow | null
  private relayClient: RelayClient | null = null

  // Track conversation state for state_sync
  private state: ConversationState = {
    messages: [],
    isLoading: false,
    streamingText: '',
    streamingTools: [],
    permissionRequest: null,
  }

  constructor(getMainWindow: () => BrowserWindow | null) {
    this.getMainWindow = getMainWindow
  }

  setRelayClient(client: RelayClient | null) {
    this.relayClient = client
  }

  send(channel: string, data?: unknown) {
    // Send to Electron renderer via IPC
    const win = this.getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, data)
    }

    // Send to relay for web clients
    const wsType = CHANNEL_TO_WS_TYPE[channel]
    if (wsType && this.relayClient?.isConnected()) {
      if (channel === 'agent:message') {
        this.relayClient.send({ type: wsType, message: data })
      } else if (channel === 'agent:error') {
        this.relayClient.send({ type: wsType, error: data })
      } else if (channel === 'agent:permission-request') {
        this.relayClient.send({ type: wsType, ...(data as Record<string, unknown>) })
      } else {
        this.relayClient.send({ type: wsType })
      }
    }

    // Track state for state_sync
    this.trackState(channel, data)
  }

  private trackState(channel: string, data: unknown) {
    switch (channel) {
      case 'agent:message': {
        const msg = data as { type: string; [key: string]: unknown }
        if (msg.type === 'stream_event') {
          const evt = msg as {
            type: string
            event: { type: string; delta?: { type: string; text?: string } }
          }
          if (evt.event.type === 'content_block_delta' && evt.event.delta?.type === 'text_delta' && evt.event.delta.text) {
            this.state.streamingText += evt.event.delta.text
          }
        } else if (msg.type === 'tool_use_summary') {
          const tool = msg as {
            type: string
            tool_name: string
            tool_input: Record<string, unknown>
            tool_result?: string
            is_error?: boolean
          }
          this.state.streamingTools.push({
            id: `tool-${Date.now()}-${Math.random()}`,
            name: tool.tool_name,
            input: tool.tool_input,
            result: tool.tool_result,
            isError: tool.is_error,
            status: tool.is_error ? 'error' : 'done',
          })
        }
        break
      }
      case 'agent:done': {
        // Finalize streaming into a message
        if (this.state.streamingText || this.state.streamingTools.length > 0) {
          this.state.messages.push({
            id: `msg-${Date.now()}`,
            role: 'assistant',
            content: this.state.streamingText,
            toolCalls: this.state.streamingTools,
          })
        }
        this.state.streamingText = ''
        this.state.streamingTools = []
        this.state.isLoading = false
        this.state.permissionRequest = null
        break
      }
      case 'agent:error': {
        this.state.messages.push({
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: `Error: ${data}`,
          toolCalls: [],
        })
        this.state.streamingText = ''
        this.state.streamingTools = []
        this.state.isLoading = false
        break
      }
      case 'agent:permission-request': {
        this.state.permissionRequest = data as { id: number; tool: string; input: unknown }
        break
      }
    }
  }

  /** Called when a new query starts */
  markQueryStart(prompt: string) {
    this.state.messages.push({
      id: `msg-${Date.now()}`,
      role: 'user',
      content: prompt,
      toolCalls: [],
    })
    this.state.isLoading = true
    this.state.streamingText = ''
    this.state.streamingTools = []
    this.state.permissionRequest = null
  }

  /** Called when loading a session replaces state */
  resetState() {
    this.state = {
      messages: [],
      isLoading: false,
      streamingText: '',
      streamingTools: [],
      permissionRequest: null,
    }
  }

  getState(): ConversationState {
    return { ...this.state }
  }

  sendStateSync() {
    if (this.relayClient?.isConnected()) {
      this.relayClient.send({ type: 'state_sync', ...this.getState() })
    }
  }
}
