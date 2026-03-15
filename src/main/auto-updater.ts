import { BrowserWindow, dialog, app } from 'electron'
import { autoUpdater } from 'electron-updater'

let mainWindow: BrowserWindow | null = null
let pendingVersion: string | null = null
let pendingDownloadVersion: string | null = null
let onMenuRebuild: (() => void) | null = null
let manualCheck = false
let lastProgressSend = 0

function sendStatus(status: Record<string, unknown>): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:status', status)
  }
}

export function initAutoUpdater(win: BrowserWindow, rebuildMenu?: () => void): void {
  mainWindow = win
  onMenuRebuild = rebuildMenu ?? null

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info: { version: string }) => {
    pendingDownloadVersion = info.version
    sendStatus({ status: 'available', version: info.version, manual: manualCheck })
  })

  autoUpdater.on('download-progress', (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => {
    const now = Date.now()
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

  autoUpdater.on('update-not-available', () => {
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

  autoUpdater.on('update-downloaded', (info: { version: string }) => {
    pendingVersion = info.version
    pendingDownloadVersion = null
    onMenuRebuild?.()
    sendStatus({ status: 'downloaded', version: info.version, manual: manualCheck })
    manualCheck = false
  })

  autoUpdater.on('error', (err: Error) => {
    console.error('[auto-updater] Error:', err.message)
    sendStatus({ status: 'error', error: err.message, manual: manualCheck })
    manualCheck = false
  })

  // Check after a short delay so the app finishes loading
  setTimeout(() => checkForUpdates(), 5000)

  // Periodic check every 4 hours
  setInterval(() => checkForUpdates(), 4 * 60 * 60 * 1000)
}

export function checkForUpdates(manual = false): void {
  if (!app.isPackaged) {
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
  autoUpdater.checkForUpdates().catch((err: Error) => {
    console.error('[auto-updater] Check failed:', err.message)
  })
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall()
}

export function getUpdateState(): string | null {
  return pendingVersion
}
