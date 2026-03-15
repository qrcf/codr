import { AlertTriangle } from 'lucide-react'

export function VersionMismatchOverlay({ desktopVersion, webVersion }: { desktopVersion: string; webVersion: string }) {
  return (
    <div className="fixed inset-0 z-9999 flex flex-col items-center justify-center bg-[#0d0d1a] text-[#e0e0e0] font-mono gap-4">
      <AlertTriangle size={48} className="text-warning mb-2" />
      <h2 className="m-0 text-xl font-semibold">
        Version Mismatch
      </h2>
      <p className="m-0 text-text-faint text-sm text-center max-w-100 leading-relaxed">
        Your desktop app (<span className="text-[#e0e0e0]">v{desktopVersion}</span>) is out of date
        with the web client (<span className="text-[#e0e0e0]">v{webVersion}</span>).
        Please download the latest version to continue.
      </p>
      <a
        href="https://codr.works"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block mt-2 bg-accent text-white px-8 py-3 rounded-lg text-sm font-medium font-mono no-underline cursor-pointer"
      >
        Download Latest Version
      </a>
      <p className="m-0 text-text-dim text-xs mt-1">
        codr.works
      </p>
    </div>
  )
}
