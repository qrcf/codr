import WebSocket from 'ws'

export type RelayStatus = 'disconnected' | 'connecting' | 'connected'

interface RelayMessage {
  type: string
  [key: string]: unknown
}

export class RelayClient {
  private ws: WebSocket | null = null
  private relayUrl: string = ''
  private apiUrl: string = ''
  private clerkToken: string = ''
  private appVersion: string = ''
  private status: RelayStatus = 'disconnected'
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 1000
  private maxReconnectDelay = 30000
  private shouldReconnect = false
  private messageHandler: ((msg: RelayMessage) => void) | null = null
  private statusHandlers: Array<(status: RelayStatus, webClients: number) => void> = []
  private webClientCount = 0

  onMessage(handler: (msg: RelayMessage) => void) {
    this.messageHandler = handler
  }

  onStatusChange(handler: (status: RelayStatus, webClients: number) => void) {
    this.statusHandlers.push(handler)
    return () => {
      this.statusHandlers = this.statusHandlers.filter((h) => h !== handler)
    }
  }

  private setStatus(status: RelayStatus) {
    this.status = status
    for (const handler of this.statusHandlers) {
      handler(status, this.webClientCount)
    }
  }

  isConnected(): boolean {
    return this.status === 'connected' && this.ws?.readyState === WebSocket.OPEN
  }

  getStatus(): { status: RelayStatus; webClients: number } {
    return { status: this.status, webClients: this.webClientCount }
  }

  getRelayUrl(): string {
    return this.relayUrl
  }

  getClerkToken(): string {
    return this.clerkToken
  }

  setApiUrl(url: string) {
    this.apiUrl = url
  }

  getApiBaseUrl(): string | null {
    return this.apiUrl || null
  }

  connect(relayUrl: string, clerkToken: string, appVersion?: string) {
    this.relayUrl = relayUrl
    this.clerkToken = clerkToken
    this.appVersion = appVersion || ''
    this.shouldReconnect = true
    this.reconnectDelay = 1000
    this.doConnect()
  }

  disconnect() {
    this.shouldReconnect = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.setStatus('disconnected')
  }

  send(data: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    }
  }

  private doConnect() {
    if (this.ws) {
      this.ws.removeAllListeners()
      this.ws.on('error', () => {}) // Absorb async errors during teardown
      this.ws.terminate()
      this.ws = null
    }

    this.setStatus('connecting')

    try {
      this.ws = new WebSocket(this.relayUrl)
    } catch {
      this.scheduleReconnect()
      return
    }

    this.ws.on('open', () => {
      // Authenticate
      this.send({ type: 'auth', token: this.clerkToken, role: 'desktop', version: this.appVersion })
    })

    this.ws.on('message', (raw) => {
      let msg: RelayMessage
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }

      if (msg.type === 'auth_result') {
        if (msg.success) {
          this.reconnectDelay = 1000
          this.setStatus('connected')
          console.log('[relay] Connected and authenticated')
        } else {
          console.error('[relay] Auth failed:', msg.error)
          this.shouldReconnect = false
          this.ws?.close()
          this.setStatus('disconnected')
        }
        return
      }

      if (msg.type === 'client_count') {
        this.webClientCount = msg.count as number
        for (const handler of this.statusHandlers) {
          handler(this.status, this.webClientCount)
        }
        return
      }

      if (msg.type === 'replaced') {
        console.log('[relay] Connection replaced by another desktop instance')
        this.shouldReconnect = false
        this.setStatus('disconnected')
        return
      }

      // Forward all other messages to handler
      this.messageHandler?.(msg)
    })

    this.ws.on('close', () => {
      if (this.shouldReconnect) {
        this.setStatus('connecting')
        this.scheduleReconnect()
      } else {
        this.setStatus('disconnected')
      }
    })

    this.ws.on('error', (err) => {
      console.error('[relay] WebSocket error:', err.message)
    })
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    console.log(`[relay] Reconnecting in ${this.reconnectDelay}ms...`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay)
      this.doConnect()
    }, this.reconnectDelay)
  }
}
