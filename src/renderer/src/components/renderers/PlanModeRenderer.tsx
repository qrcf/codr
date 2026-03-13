import { ClipboardList, Check } from 'lucide-react'
import type { ToolCallInfo } from '../../types'

export function EnterPlanModeRenderer({ tool }: { tool: ToolCallInfo }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-[#c0a878] text-[0.9em]">
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#c0a878] text-[#1a1a1a] text-[0.8em] font-bold flex-shrink-0"><ClipboardList size={14} /></span>
      <span className="font-medium">Entered plan mode</span>
      {tool.status === 'running' && <span className="text-[#999] animate-[pulse_1.5s_infinite]">...</span>}
    </div>
  )
}

export function ExitPlanModeRenderer({ tool }: { tool: ToolCallInfo }) {
  const prompts = tool.input.allowedPrompts as Array<{ tool: string; prompt: string }> | undefined
  const isApproved = tool.status === 'done' && !tool.isError
  const isRejected = tool.status === 'error' || tool.isError
  const isRunning = tool.status === 'running'

  const color = isApproved ? 'text-[#78c090]' : isRejected ? 'text-[#c0a070]' : 'text-[#c0a878]'
  const iconBg = isApproved ? 'bg-[#78c090]' : isRejected ? 'bg-[#c0a070]' : 'bg-[#c0a878]'
  const label = isApproved
    ? 'Plan approved'
    : isRejected
      ? 'Plan — changes requested'
      : 'Plan ready for review'

  return (
    <div className={`flex items-center gap-2 px-3 py-2 text-[0.9em] ${color}`}>
      <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[#1a1a1a] text-[0.8em] font-bold flex-shrink-0 ${iconBg}`}><ClipboardList size={14} /></span>
      <span className="font-medium">{label}</span>
      {isApproved && <Check size={14} />}
      {isRunning && prompts && prompts.length > 0 && (
        <span className="text-[0.8em] px-[6px] py-[1px] rounded-[3px] bg-[#3a3a2a] text-[#c0a878]">{prompts.length} allowed tool{prompts.length !== 1 ? 's' : ''}</span>
      )}
    </div>
  )
}
