import { Download, Loader2, AlertCircle, CheckCircle } from 'lucide-react'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function UpdateOverlay({ status, onRestart, onDismiss }: {
  status: UpdateStatus
  onRestart: () => void
  onDismiss: () => void
}) {
  const secondaryBtn = 'px-8 py-3 rounded-lg text-sm font-medium font-mono cursor-pointer bg-transparent text-neutral-500 border border-neutral-700 hover:border-neutral-500 transition-colors'
  const primaryBtn = 'px-8 py-3 rounded-lg text-sm font-medium font-mono cursor-pointer bg-purple-700 text-white border-none hover:bg-purple-600 transition-colors'

  if (status.status === 'checking') {
    return (
      <div className="fixed inset-0 z-9999 flex flex-col items-center justify-center bg-[#0d0d1a] text-neutral-200 font-mono gap-4">
        <Loader2 size={48} className="text-purple-600 mb-2 animate-spin" />
        <h2 className="m-0 text-xl font-semibold">Checking for Updates...</h2>
        <p className="m-0 text-neutral-500 text-sm">Looking for new versions of Codr</p>
        <div className="flex gap-3 mt-2">
          <button onClick={onDismiss} className={secondaryBtn}>Cancel</button>
        </div>
      </div>
    )
  }

  if (status.status === 'available' || status.status === 'downloading') {
    const progress = status.progress
    const percent = progress ? Math.round(progress.percent) : 0

    return (
      <div className="fixed inset-0 z-9999 flex flex-col items-center justify-center bg-[#0d0d1a] text-neutral-200 font-mono gap-4">
        <Download size={48} className="text-purple-600 mb-2" />
        <h2 className="m-0 text-xl font-semibold">Downloading Update</h2>
        {status.version && (
          <p className="m-0 text-neutral-500 text-sm">
            Codr <span className="text-neutral-200">v{status.version}</span>
          </p>
        )}
        <div className="w-75 mt-2">
          <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-purple-600 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="flex justify-between mt-2 text-xs text-neutral-500">
            {progress ? (
              <>
                <span>{formatBytes(progress.transferred)} / {formatBytes(progress.total)}</span>
                <span>{formatBytes(progress.bytesPerSecond)}/s</span>
              </>
            ) : (
              <span>Starting download...</span>
            )}
          </div>
          <div className="text-center mt-1 text-[13px] text-neutral-400">
            {percent}%
          </div>
        </div>
        <div className="flex gap-3 mt-2">
          <button onClick={onDismiss} className={secondaryBtn}>Cancel</button>
        </div>
      </div>
    )
  }

  if (status.status === 'downloaded') {
    return (
      <div className="fixed inset-0 z-9999 flex flex-col items-center justify-center bg-[#0d0d1a] text-neutral-200 font-mono gap-4">
        <CheckCircle size={48} className="text-purple-600 mb-2" />
        <h2 className="m-0 text-xl font-semibold">Update Ready</h2>
        <p className="m-0 text-neutral-500 text-sm text-center max-w-100 leading-relaxed">
          Codr <span className="text-neutral-200">v{status.version}</span> has been downloaded
          and is ready to install. Restart to update.
        </p>
        <div className="flex gap-3 mt-2">
          <button onClick={onDismiss} className={secondaryBtn}>Later</button>
          <button onClick={onRestart} className={primaryBtn}>Restart Now</button>
        </div>
      </div>
    )
  }

  if (status.status === 'error') {
    return (
      <div className="fixed inset-0 z-9999 flex flex-col items-center justify-center bg-[#0d0d1a] text-neutral-200 font-mono gap-4">
        <AlertCircle size={48} className="text-red-400 mb-2" />
        <h2 className="m-0 text-xl font-semibold">Update Error</h2>
        <p className="m-0 text-neutral-500 text-sm text-center max-w-100 leading-relaxed">
          {status.error || 'Could not check for updates.'}
        </p>
        <div className="flex gap-3 mt-2">
          <button onClick={onDismiss} className={secondaryBtn}>Dismiss</button>
        </div>
      </div>
    )
  }

  return null
}
