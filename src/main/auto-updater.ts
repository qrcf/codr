import { BrowserWindow, dialog, app } from 'electron'

let mainWindow: BrowserWindow | null = null
let pendingVersion: string | null = null
let onMenuRebuild: (() => void) | null = null
let manualCheck = false

// Cached reference — populated once by initAutoUpdater()
let updater: import('electron-updater').AppUpdater | null = null
let updaterInitPromise: Promise<void> | null = null
let updateCheckTimersStarted = false

function configureUpdater(loadedUpdater: import('electron-updater').AppUpdater): void {
  loadedUpdater.autoDownload = true
  loadedUpdater.autoInstallOnAppQuit = true

  loadedUpdater.on('update-not-available', () => {
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
    onMenuRebuild?.()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:status', { status: 'downloaded', version: info.version })
    }
    if (manualCheck) {
      manualCheck = false
      dialog.showMessageBox(mainWindow!, {
        type: 'info',
        title: 'Update Ready',
        message: `Codr v${info.version} has been downloaded.`,
        detail: 'Restart now to apply the update.',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
      }).then(({ response }) => {
        if (response === 0) quitAndInstall()
      })
    }
  })

  loadedUpdater.on('error', (err: Error) => {
    console.error('[auto-updater] Error:', err.message)
    if (manualCheck) {
      manualCheck = false
      dialog.showMessageBox({
        type: 'error',
        title: 'Update Error',
        message: 'Could not check for updates.',
        detail: err.message,
      })
    }
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
  }).finally(() => {
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

export function checkForUpdates(manual = false): void {
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
