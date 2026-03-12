import path from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { app, screen, type BrowserWindow } from 'electron'

interface WindowState {
  x: number
  y: number
  width: number
  height: number
  isMaximized: boolean
}

const STATE_FILE = 'window-state.json'
const MIN_WIDTH = 400
const MIN_HEIGHT = 300

function statePath(): string {
  return path.join(app.getPath('userData'), STATE_FILE)
}

/**
 * Load saved window state from disk. Returns null on first launch,
 * corrupt data, or if the saved position is off-screen.
 */
export function loadWindowState(): WindowState | null {
  try {
    const raw = readFileSync(statePath(), 'utf-8')
    const state = JSON.parse(raw) as WindowState

    // Validate dimensions
    if (
      typeof state.width !== 'number' || typeof state.height !== 'number' ||
      state.width < MIN_WIDTH || state.height < MIN_HEIGHT
    ) {
      return null
    }

    // Check if the saved position is still visible on a connected display
    if (typeof state.x === 'number' && typeof state.y === 'number') {
      const display = screen.getDisplayMatching({
        x: state.x,
        y: state.y,
        width: state.width,
        height: state.height,
      })
      const { x: dx, y: dy, width: dw, height: dh } = display.workArea

      // Check if at least 100px of the window overlaps with the display
      const overlapX = Math.max(0, Math.min(state.x + state.width, dx + dw) - Math.max(state.x, dx))
      const overlapY = Math.max(0, Math.min(state.y + state.height, dy + dh) - Math.max(state.y, dy))

      if (overlapX < 100 || overlapY < 100) {
        // Position is off-screen — keep size but drop position
        return { width: state.width, height: state.height, isMaximized: state.isMaximized } as WindowState
      }
    }

    return state
  } catch {
    return null
  }
}

/**
 * Track window move/resize events and persist state to disk.
 */
export function trackWindowState(win: BrowserWindow): void {
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let lastBounds = win.getBounds()

  function save(): void {
    try {
      const isMaximized = win.isMaximized()
      // When maximized, keep the last non-maximized bounds
      const bounds = isMaximized ? lastBounds : win.getBounds()
      if (!isMaximized) {
        lastBounds = bounds
      }
      const state: WindowState = {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        isMaximized,
      }
      writeFileSync(statePath(), JSON.stringify(state))
    } catch {
      // Silently ignore write failures
    }
  }

  function debouncedSave(): void {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(save, 500)
  }

  win.on('resize', debouncedSave)
  win.on('move', debouncedSave)
  win.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer)
    save()
  })
}
