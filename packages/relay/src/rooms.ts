import type { WebSocket } from 'ws'

interface Room {
  desktop: WebSocket | null
  webClients: Set<WebSocket>
}

const rooms = new Map<string, Room>()

function getOrCreateRoom(userId: string): Room {
  let room = rooms.get(userId)
  if (!room) {
    room = { desktop: null, webClients: new Set() }
    rooms.set(userId, room)
  }
  return room
}

function sendJson(ws: WebSocket, data: unknown) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data))
  }
}

export function registerDesktop(userId: string, ws: WebSocket) {
  const room = getOrCreateRoom(userId)

  // Close existing desktop connection if any
  if (room.desktop && room.desktop !== ws && room.desktop.readyState === room.desktop.OPEN) {
    sendJson(room.desktop, { type: 'replaced' })
    room.desktop.close()
  }

  room.desktop = ws

  // Notify all web clients that desktop is online
  for (const client of room.webClients) {
    sendJson(client, { type: 'desktop_status', online: true })
  }

  // Notify desktop of current web client count
  sendJson(ws, { type: 'client_count', count: room.webClients.size })
}

export function registerWeb(userId: string, ws: WebSocket) {
  const room = getOrCreateRoom(userId)
  room.webClients.add(ws)

  // Tell web client whether desktop is online
  const desktopOnline = room.desktop !== null && room.desktop.readyState === room.desktop.OPEN
  sendJson(ws, { type: 'auth_result', success: true, desktopOnline })

  if (desktopOnline) {
    // Request state sync from desktop for the new web client
    sendJson(room.desktop!, { type: 'request_state_sync' })
  }

  // Notify desktop of updated client count
  if (room.desktop && room.desktop.readyState === room.desktop.OPEN) {
    sendJson(room.desktop, { type: 'client_count', count: room.webClients.size })
  }
}

export function removeDesktop(userId: string) {
  const room = rooms.get(userId)
  if (!room) return

  room.desktop = null

  // Notify all web clients
  for (const client of room.webClients) {
    sendJson(client, { type: 'desktop_status', online: false })
  }

  // Clean up empty rooms
  if (room.webClients.size === 0) {
    rooms.delete(userId)
  }
}

export function removeWeb(userId: string, ws: WebSocket) {
  const room = rooms.get(userId)
  if (!room) return

  room.webClients.delete(ws)

  // Notify desktop of updated client count
  if (room.desktop && room.desktop.readyState === room.desktop.OPEN) {
    sendJson(room.desktop, { type: 'client_count', count: room.webClients.size })
  }

  // Clean up empty rooms
  if (!room.desktop && room.webClients.size === 0) {
    rooms.delete(userId)
  }
}

export function forwardToDesktop(userId: string, message: unknown): boolean {
  const room = rooms.get(userId)
  if (!room?.desktop || room.desktop.readyState !== room.desktop.OPEN) {
    return false
  }
  sendJson(room.desktop, message)
  return true
}

export function forwardToWeb(userId: string, message: unknown) {
  const room = rooms.get(userId)
  if (!room) return

  for (const client of room.webClients) {
    sendJson(client, message)
  }
}

export function getRoomStats() {
  const stats: Array<{ userId: string; desktopOnline: boolean; webClients: number }> = []
  for (const [userId, room] of rooms) {
    stats.push({
      userId,
      desktopOnline: room.desktop !== null && room.desktop.readyState === room.desktop.OPEN,
      webClients: room.webClients.size,
    })
  }
  return stats
}
