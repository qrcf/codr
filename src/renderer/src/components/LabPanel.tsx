import { useState } from 'react'
import { useCodr } from '../hooks/useCodr'

export function LabPanel() {
  const codr = useCodr()
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [sessionDetail, setSessionDetail] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const handleListSessions = async () => {
    setSessionsLoading(true)
    try {
      const result = await codr.listSessions()
      setSessions(result.sessions)
    } catch {
      setSessions([])
    } finally {
      setSessionsLoading(false)
    }
  }

  const handleSelectSession = async (sessionId: string) => {
    if (selectedSession === sessionId) {
      setSelectedSession(null)
      setSessionDetail(null)
      return
    }
    setSelectedSession(sessionId)
    setSessionDetail(null)
    setDetailLoading(true)
    try {
      const messages = await codr.getSessionMessages(sessionId)
      setSessionDetail(JSON.stringify(messages, null, 2))
    } catch (err) {
      setSessionDetail(JSON.stringify({ error: String(err) }, null, 2))
    } finally {
      setDetailLoading(false)
    }
  }

  const sectionTitleClass = 'm-0 mb-3 text-[13px] font-semibold text-[#888] uppercase tracking-[0.05em]'

  return (
    <div>
      <section className="mb-8">
        <h3 className={sectionTitleClass}>Sessions</h3>
        <button
          className="bg-[#2a2a3d] border border-[#3a3a5a] text-[#ccc] px-4 py-2 rounded-md cursor-pointer text-[13px] transition-colors duration-150 mb-4 hover:bg-[#3a3a5a] hover:text-[#e0e0e0]"
          onClick={handleListSessions}
          disabled={sessionsLoading}
        >
          {sessionsLoading ? 'Loading...' : sessions.length ? 'Refresh Sessions' : 'Load Sessions'}
        </button>

        {sessions.length > 0 && (
          <div className="flex flex-col gap-0.5">
            {sessions.map((s) => (
              <div key={s.sessionId}>
                <button
                  className={[
                    'relative w-full bg-bg-tertiary border rounded-md px-3.5 py-2.5 cursor-pointer text-left transition-colors duration-150 text-inherit group',
                    selectedSession === s.sessionId
                      ? 'bg-[#22223a] border-accent'
                      : 'border-border-subtle hover:bg-[#22223a] hover:border-[#3a3a5a]',
                  ].join(' ')}
                  onClick={() => handleSelectSession(s.sessionId)}
                >
                  <div className="text-[#ddd] text-[13px] whitespace-nowrap overflow-hidden text-ellipsis mb-1">
                    {s.customTitle || s.generatedTitle || s.summary || s.sessionId.slice(0, 8)}
                  </div>
                  <div className="flex gap-2.5 text-[11px] text-text-dim">
                    <span className="whitespace-nowrap">{s.sessionId.slice(0, 8)}</span>
                    {s.provider && <span className="whitespace-nowrap">{s.provider}</span>}
                    {s.cwd && <span className="whitespace-nowrap">{s.cwd.split('/').pop()}</span>}
                    <span className="whitespace-nowrap">{new Date(s.lastModified).toLocaleDateString()}</span>
                  </div>
                  {/* Tooltip on hover */}
                  <div className="hidden group-hover:block absolute left-full top-0 ml-2 bg-[#0e0e16] border border-border-subtle rounded-md p-3 z-100 max-w-105 max-h-80 overflow-auto pointer-events-none max-[768px]:hidden!">
                    <pre className="m-0 font-mono text-[11px] text-[#a0d0a0] whitespace-pre-wrap break-all">{JSON.stringify(s, null, 2)}</pre>
                  </div>
                </button>

                {selectedSession === s.sessionId && (
                  <div className="bg-[#0e0e16] border border-border-subtle rounded-b-md border-t-0 p-4 overflow-auto max-h-[50vh] -mt-px">
                    {detailLoading ? (
                      <div className="text-text-dim italic text-[13px]">Loading session messages...</div>
                    ) : (
                      <pre className="m-0 font-mono text-[12px] text-[#a0d0a0] whitespace-pre-wrap break-all">{sessionDetail}</pre>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
