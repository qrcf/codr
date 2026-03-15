import { Monitor } from 'lucide-react'

export function ConnectionOverlay() {
  return (
    <div className="fixed inset-0 z-9999 flex flex-col items-center justify-center bg-[#0d0d1a] text-[#e0e0e0] font-mono gap-4">
      <Monitor size={48} className="text-text-dim mb-2" />
      <h2 className="m-0 text-xl font-semibold">
        Desktop App Not Connected
      </h2>
      <p className="m-0 text-text-faint text-sm text-center max-w-90 leading-relaxed">
        The Codr desktop app must be running and connected for web access to work.
      </p>
      <div className="flex items-center gap-2 mt-2 text-text-dim text-[13px]">
        <div className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse-dot" />
        Waiting for desktop app...
      </div>
    </div>
  )
}
