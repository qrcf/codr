import { createServer } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { verifyClerkToken } from './auth.js'
import {
  registerDesktop,
  registerWeb,
  removeDesktop,
  removeWeb,
  forwardToDesktop,
  forwardToWeb,
  getRoomStats,
} from './rooms.js'

const PORT = parseInt(process.env.PORT || '8080', 10)
const AUTH_TIMEOUT_MS = 5_000
const HEARTBEAT_INTERVAL_MS = 30_000
const HEARTBEAT_TIMEOUT_MS = 10_000

// Messages from desktop that get forwarded to web clients
const DESKTOP_FORWARD_TYPES = new Set([
  'agent_message',
  'agent_error',
  'agent_done',
  'permission_request',
  'sessions_refresh_hint',
  'state_sync',
  'response',
])

// Messages from web that get forwarded to desktop
const WEB_FORWARD_TYPES = new Set([
  'query',
  'interrupt',
  'permission_response',
  'settings_update',
  'request',
])

interface ClientState {
  userId: string | null
  role: 'desktop' | 'web' | null
  alive: boolean
  authTimer: ReturnType<typeof setTimeout> | null
}

const clientState = new WeakMap<WebSocket, ClientState>()

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', rooms: getRoomStats() }))
    return
  }

  res.writeHead(404)
  res.end('Not Found')
})

const wss = new WebSocketServer({ server })

wss.on('connection', (ws: WebSocket) => {
  const state: ClientState = {
    userId: null,
    role: null,
    alive: true,
    authTimer: setTimeout(() => {
      if (!state.userId) {
        ws.close(4001, 'Auth timeout')
      }
    }, AUTH_TIMEOUT_MS),
  }
  clientState.set(ws, state)

  ws.on('pong', () => {
    state.alive = true
  })

  ws.on('message', async (raw) => {
    let msg: { type: string; [key: string]: unknown }
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }

    // Handle auth
    if (msg.type === 'auth') {
      if (state.userId) return // Already authenticated

      const token = msg.token as string
      const role = msg.role as 'desktop' | 'web'

      if (!token || !role || !['desktop', 'web'].includes(role)) {
        ws.send(JSON.stringify({ type: 'auth_result', success: false, error: 'Invalid auth message' }))
        ws.close(4002, 'Invalid auth')
        return
      }

      const result = await verifyClerkToken(token)
      if (!result) {
        ws.send(JSON.stringify({ type: 'auth_result', success: false, error: 'Invalid token' }))
        ws.close(4003, 'Invalid token')
        return
      }

      state.userId = result.userId
      state.role = role

      if (state.authTimer) {
        clearTimeout(state.authTimer)
        state.authTimer = null
      }

      if (role === 'desktop') {
        ws.send(JSON.stringify({ type: 'auth_result', success: true }))
        registerDesktop(result.userId, ws)
      } else {
        registerWeb(result.userId, ws)
        // auth_result is sent inside registerWeb
      }

      console.log(`[auth] ${role} connected for user ${result.userId}`)
      return
    }

    // All other messages require authentication
    if (!state.userId || !state.role) {
      ws.send(JSON.stringify({ type: 'error', error: 'Not authenticated' }))
      return
    }

    // Route messages based on role
    if (state.role === 'desktop' && DESKTOP_FORWARD_TYPES.has(msg.type)) {
      forwardToWeb(state.userId, msg)
    } else if (state.role === 'web' && WEB_FORWARD_TYPES.has(msg.type)) {
      const delivered = forwardToDesktop(state.userId, msg)
      if (!delivered) {
        ws.send(JSON.stringify({ type: 'error', error: 'Desktop is offline' }))
      }
    }
  })

  ws.on('close', () => {
    if (state.authTimer) {
      clearTimeout(state.authTimer)
    }

    if (state.userId && state.role) {
      if (state.role === 'desktop') {
        removeDesktop(state.userId)
      } else {
        removeWeb(state.userId, ws)
      }
      console.log(`[disconnect] ${state.role} for user ${state.userId}`)
    }
  })

  ws.on('error', (err) => {
    console.error('[ws error]', err.message)
  })
})

// Heartbeat to detect stale connections
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    const state = clientState.get(ws)
    if (!state) return

    if (!state.alive) {
      ws.terminate()
      return
    }

    state.alive = false
    ws.ping()
  })
}, HEARTBEAT_INTERVAL_MS)

wss.on('close', () => {
  clearInterval(heartbeatInterval)
})

server.listen(PORT, () => {
  console.log(`Relay server listening on port ${PORT}`)
})
