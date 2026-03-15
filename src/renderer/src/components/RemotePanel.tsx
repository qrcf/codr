import { useState, useEffect } from 'react'
import { useCodr } from '../hooks/useCodr'

export function RemotePanel() {
  const codr = useCodr()
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected')
  const [webClients, setWebClients] = useState(0)

  // Listen for status changes (relay auto-connects from main process)
  useEffect(() => {
    codr.getRemoteStatus?.().then((s) => {
      if (s) {
        setStatus(s.status)
        setWebClients(s.webClients)
      }
    })

    const unsub = codr.onRemoteStatusChange?.((s) => {
      setStatus(s.status as 'disconnected' | 'connecting' | 'connected')
      setWebClients(s.webClients)
    })
    return () => unsub?.()
  }, [codr])

  const dotColor =
    status === 'connected'
      ? 'bg-[#4caf50]'
      : status === 'connecting'
        ? 'bg-[#f0c040] animate-[pulse-dot_1.5s_ease-in-out_infinite]'
        : 'bg-[#666]'

  return (
    <div>
      <div className="flex items-center gap-1.5 text-[12px] text-[#aaa]">
        <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
        <span className="text-text-faint text-[11px]">
          {status === 'connected' && 'Remote'}
          {status === 'connecting' && 'Connecting...'}
          {status === 'disconnected' && 'Offline'}
        </span>
        {status === 'connected' && webClients > 0 && (
          <span className="text-text-dim text-[11px] ml-auto">
            {webClients} viewer{webClients !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </div>
  )
}
