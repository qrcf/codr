import { useState } from 'react'
import { ClipboardList } from 'lucide-react'
import type { PlanReviewState } from '../types'

interface PlanReviewProps {
  plan: PlanReviewState
  showActions: boolean
  onApprove: () => void
  onRequestChanges: (feedback: string) => void
}

export function PlanReview({ showActions, onApprove, onRequestChanges }: PlanReviewProps) {
  const [editing, setEditing] = useState(false)
  const [feedback, setFeedback] = useState('')

  const handleSendFeedback = () => {
    const text = feedback.trim()
    if (text) {
      onRequestChanges(text)
    }
  }

  const handleFeedbackKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendFeedback()
    }
  }

  if (!showActions) return null

  return (
    <div className="overflow-hidden">
      <div className="plan-review-header flex items-center gap-2 px-[14px] py-[10px] bg-[#2a2a24] font-semibold text-[#c0a878]">
        <span className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-full bg-[#c0a878] text-[#1a1a1a] text-[0.85em] font-bold flex-shrink-0"><ClipboardList size={14} /></span>
        Plan ready for review
      </div>
      {!editing && (
        <div className="plan-review-actions flex gap-2 px-[14px] py-[10px] justify-end border-t border-[#3a3a30] max-[768px]:flex-wrap max-[768px]:gap-[6px]">
          <button className="border-none rounded-md px-4 py-2 text-[0.9em] font-medium cursor-pointer transition-[background] duration-150 bg-[#555] text-white hover:bg-[#666] disabled:opacity-40 disabled:cursor-not-allowed max-[768px]:min-h-[40px] max-[768px]:flex-1" onClick={() => setEditing(true)}>
            Request Changes
          </button>
          <button className="border-none rounded-md px-4 py-2 text-[0.9em] font-medium cursor-pointer transition-[background] duration-150 bg-[#4caf50] text-white hover:bg-[#43a047] disabled:opacity-40 disabled:cursor-not-allowed max-[768px]:min-h-[40px] max-[768px]:flex-1" onClick={onApprove}>
            Approve Plan
          </button>
        </div>
      )}
      {editing && (
        <div className="plan-review-feedback border-t border-[#3a3a30]">
          <textarea
            className="w-full bg-[#1a1a18] border-0 border-b border-[#3a3a30] px-[14px] py-[10px] text-inherit font-[inherit] text-[0.9em] resize-y min-h-[60px] box-border focus:outline-none focus:bg-[#1e1e30]"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={handleFeedbackKeyDown}
            placeholder="Describe what changes you'd like..."
            rows={3}
            autoFocus
          />
          <div className="plan-review-actions flex gap-2 px-[14px] py-[10px] justify-end border-t border-[#3a3a30] max-[768px]:flex-wrap max-[768px]:gap-[6px]">
            <button className="border-none rounded-md px-4 py-2 text-[0.9em] font-medium cursor-pointer transition-[background] duration-150 bg-[#555] text-white hover:bg-[#666] disabled:opacity-40 disabled:cursor-not-allowed max-[768px]:min-h-[40px] max-[768px]:flex-1" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button
              className="border-none rounded-md px-4 py-2 text-[0.9em] font-semibold cursor-pointer bg-gradient-to-b from-[#9354d4] to-[#7438b8] text-white shadow-[0_1px_3px_rgba(129,66,199,0.35),inset_0_1px_0_rgba(255,255,255,0.1)] [text-shadow:0_1px_1px_rgba(0,0,0,0.15)] tracking-[0.01em] hover:not-disabled:from-[#8548c5] hover:not-disabled:to-[#6830a8] disabled:opacity-40 disabled:cursor-not-allowed max-[768px]:min-h-[40px] max-[768px]:flex-1"
              onClick={handleSendFeedback}
              disabled={!feedback.trim()}
            >
              Send Feedback
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
