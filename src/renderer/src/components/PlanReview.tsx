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
    <div className="plan-review">
      <div className="plan-review-header">
        <span className="plan-review-icon"><ClipboardList size={14} /></span>
        Plan ready for review
      </div>
      {!editing && (
        <div className="plan-review-actions">
          <button className="btn btn-deny" onClick={() => setEditing(true)}>
            Request Changes
          </button>
          <button className="btn btn-approve" onClick={onApprove}>
            Approve Plan
          </button>
        </div>
      )}
      {editing && (
        <div className="plan-review-feedback">
          <textarea
            className="plan-review-textarea"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={handleFeedbackKeyDown}
            placeholder="Describe what changes you'd like..."
            rows={3}
            autoFocus
          />
          <div className="plan-review-actions">
            <button className="btn btn-deny" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button
              className="btn btn-send"
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
