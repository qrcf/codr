import { BrowserWindow, dialog, app } from 'electron'

let mainWindow: BrowserWindow | null = null
let pendingVersion: string | null = null
let pendingDownloadVersion: string | null = null
let onMenuRebuild: (() => void) | null = null
let manualCheck = false
let lastProgressSend = 0

// Cached reference — populated once by initAutoUpdater()
let updater: import('electron-updater').AppUpdater | null = null
let updaterInitPromise: Promise<void> | null = null
let updateCheckTimersStarted = false

function sendStatus(status: Record<string, unknown>): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:status', status)
  }
}

function configureUpdater(loadedUpdater: import('electron-updater').AppUpdater): void {
  loadedUpdater.autoDownload = true
  loadedUpdater.autoInstallOnAppQuit = true

  loadedUpdater.on('update-available', (info: { version: string }) => {
    pendingDownloadVersion = info.version
    sendStatus({ status: 'available', version: info.version, manual: manualCheck })
  })

  loadedUpdater.on('download-progress', (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => {
    const now = Date.now()
    // Throttle to ~200ms, but always send the final event
    if (now - lastProgressSend < 200 && progress.percent < 100) return
    lastProgressSend = now
    sendStatus({
      status: 'downloading',
      version: pendingDownloadVersion,
      manual: manualCheck,
      progress: {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      },
    })
  })

  loadedUpdater.on('update-not-available', () => {
    sendStatus({ status: 'not-available', manual: manualCheck })
    if (manualCheck) {
      manualCheck = false
      dialog.showMessageBox({
        type: 'info',
        title: 'No Updates',
        message: `Codr v${app.getVersion()} is up to date.`,
      })
    }
  })

  loadedUpdater.on('update-downloaded', (info: { version: string }) => {
    pendingVersion = info.version
    pendingDownloadVersion = null
    onMenuRebuild?.()
    sendStatus({ status: 'downloaded', version: info.version, manual: manualCheck })
    manualCheck = false
  })

  loadedUpdater.on('error', (err: Error) => {
    console.error('[auto-updater] Error:', err.message)
    sendStatus({ status: 'error', error: err.message, manual: manualCheck })
    manualCheck = false
  })
}

function ensureUpdater(): Promise<void> {
  if (updater) return Promise.resolve()
  if (updaterInitPromise) return updaterInitPromise

  updaterInitPromise = import('electron-updater').then(({ autoUpdater }) => {
    updater = autoUpdater
    configureUpdater(autoUpdater)

    if (!updateCheckTimersStarted) {
      updateCheckTimersStarted = true

      // Check after a short delay so the app finishes loading
      setTimeout(() => checkForUpdates(), 5000)

      // Periodic check every 4 hours
      setInterval(() => checkForUpdates(), 4 * 60 * 60 * 1000)
    }
  }).catch((err: Error) => {
    console.error('[auto-updater] Failed to initialize:', err.message)
    updaterInitPromise = null
  })

  return updaterInitPromise
}

export function initAutoUpdater(win: BrowserWindow, rebuildMenu?: () => void): void {
  // Lazy-load electron-updater so nothing runs at import time.
  // In dev mode (unpackaged) this function is never called, avoiding the
  // missing app-update.yml crash.
  mainWindow = win
  onMenuRebuild = rebuildMenu ?? null
  void ensureUpdater()
}

export async function checkForUpdates(manual = false): Promise<void> {
  await ensureUpdater()
  if (!updater) {
    if (manual) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Updates',
        message: 'Update checking is not available in development mode.',
      })
    }
    return
  }
  manualCheck = manual
  if (manual) {
    sendStatus({ status: 'checking', manual: true })
  }
  updater.checkForUpdates().catch((err: Error) => {
    console.error('[auto-updater] Check failed:', err.message)
  })
}

export function quitAndInstall(): void {
  if (!updater) return
  updater.quitAndInstall()
}

export function getUpdateState(): string | null {
  return pendingVersion
}
