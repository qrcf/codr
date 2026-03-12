import { useState } from 'react'

export function QuestionDialog({ request, onRespond }: {
  request: { id: number; questions: QuestionItem[] }
  onRespond: (id: number, answers: Record<string, string>) => void
}) {
  const [selections, setSelections] = useState<Record<string, Set<string>>>({})
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({})
  const [showOther, setShowOther] = useState<Record<string, boolean>>({})
  const [currentStep, setCurrentStep] = useState(0)

  const totalSteps = request.questions.length
  const isFirstStep = currentStep === 0
  const isLastStep = currentStep === totalSteps - 1
  const isSingleQuestion = totalSteps === 1
  const currentQuestion = request.questions[currentStep]

  const toggleOption = (question: string, label: string, multiSelect: boolean) => {
    setSelections((prev) => {
      const current = prev[question] || new Set<string>()
      const next = new Set(current)

      if (multiSelect) {
        if (next.has(label)) next.delete(label)
        else next.add(label)
      } else {
        next.clear()
        next.add(label)
      }

      // Clear "Other" if selecting a regular option in single-select
      if (!multiSelect && label !== '__other__') {
        setShowOther((p) => ({ ...p, [question]: false }))
      }

      return { ...prev, [question]: next }
    })
  }

  const toggleOther = (question: string, multiSelect: boolean) => {
    if (!multiSelect) {
      setSelections((prev) => {
        const next = new Set<string>()
        next.add('__other__')
        return { ...prev, [question]: next }
      })
    }
    setShowOther((prev) => ({ ...prev, [question]: !prev[question] }))
  }

  const handleSubmit = () => {
    const answers: Record<string, string> = {}
    for (const q of request.questions) {
      const sel = selections[q.question]
      if (!sel || sel.size === 0) continue

      const labels: string[] = []
      for (const s of sel) {
        if (s === '__other__') {
          const text = otherTexts[q.question]?.trim()
          if (text) labels.push(text)
        } else {
          labels.push(s)
        }
      }
      answers[q.question] = labels.join(', ')
    }
    onRespond(request.id, answers)
  }

  const handleNext = () => {
    if (currentStep < totalSteps - 1) {
      setCurrentStep(currentStep + 1)
    }
  }

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    }
  }

  const allAnswered = request.questions.every((q) => {
    const sel = selections[q.question]
    if (!sel || sel.size === 0) return false
    if (sel.has('__other__') && !otherTexts[q.question]?.trim()) return false
    return true
  })

  const currentStepAnswered = (() => {
    const sel = selections[currentQuestion.question]
    if (!sel || sel.size === 0) return false
    if (sel.has('__other__') && !otherTexts[currentQuestion.question]?.trim()) return false
    return true
  })()

  return (
    <div className="question-dialog">
      <div className="question-header">
        <span className="question-icon">?</span>
        Question
        {!isSingleQuestion && (
          <span className="question-step-indicator">
            {currentStep + 1} of {totalSteps}
          </span>
        )}
      </div>
      {!isSingleQuestion && (
        <div className="question-stepper">
          {request.questions.map((_, idx) => {
            let dotClass = 'question-step-dot'
            if (idx === currentStep) dotClass += ' active'
            else if (idx < currentStep) dotClass += ' completed'
            return <div key={idx} className={dotClass} />
          })}
        </div>
      )}
      <div key={currentQuestion.question} className="question-item">
        <div className="question-badge">{currentQuestion.header}</div>
        <div className="question-text">{currentQuestion.question}</div>
        <div className="question-options">
          {currentQuestion.options.map((opt) => {
            const selected = selections[currentQuestion.question]?.has(opt.label)
            return (
              <button
                key={opt.label}
                className={`question-option${selected ? ' selected' : ''}`}
                onClick={() => toggleOption(currentQuestion.question, opt.label, currentQuestion.multiSelect)}
              >
                <span className="option-label">{opt.label}</span>
                <span className="option-desc">{opt.description}</span>
              </button>
            )
          })}
          <button
            className={`question-option question-option-other${showOther[currentQuestion.question] ? ' selected' : ''}`}
            onClick={() => toggleOther(currentQuestion.question, currentQuestion.multiSelect)}
          >
            <span className="option-label">Other</span>
            <span className="option-desc">Provide a custom answer</span>
          </button>
        </div>
        {showOther[currentQuestion.question] && (
          <textarea
            className="question-other-input"
            placeholder="Type your answer..."
            value={otherTexts[currentQuestion.question] || ''}
            onChange={(e) => setOtherTexts((prev) => ({ ...prev, [currentQuestion.question]: e.target.value }))}
            rows={2}
          />
        )}
      </div>
      <div className="question-actions">
        {!isFirstStep && (
          <button className="btn btn-deny" onClick={handleBack}>
            Back
          </button>
        )}
        {isLastStep ? (
          <button
            className="btn btn-approve"
            onClick={handleSubmit}
            disabled={!allAnswered}
          >
            Submit
          </button>
        ) : (
          <button
            className="btn btn-approve"
            onClick={handleNext}
            disabled={!currentStepAnswered}
          >
            Next
          </button>
        )}
      </div>
    </div>
  )
}
