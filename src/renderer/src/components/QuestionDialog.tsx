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
    if (currentStep < totalSteps - 1) setCurrentStep(currentStep + 1)
  }

  const handleBack = () => {
    if (currentStep > 0) setCurrentStep(currentStep - 1)
  }

  const allAnswered = request.questions.every((q) => {
    const sel = selections[q.question]
    return !!(sel && sel.size > 0 && (!sel.has('__other__') || otherTexts[q.question]?.trim()))
  })

  const currentStepAnswered = (() => {
    const sel = selections[currentQuestion.question]
    return !!(sel && sel.size > 0 && (!sel.has('__other__') || otherTexts[currentQuestion.question]?.trim()))
  })()

  return (
    <div className="max-[768px]:text-[0.9em]">
      <div className="question-header flex items-center gap-2 px-3.5 py-2.5 bg-border-subtle font-semibold text-accent max-[768px]:px-3 max-[768px]:py-2">
        <span className="inline-flex items-center justify-center w-5.5 h-5.5 rounded-full bg-accent text-white text-[0.85em] font-bold shrink-0">?</span>
        Question
        {!isSingleQuestion && (
          <span className="ml-auto text-[0.8em] font-normal text-text-muted">
            {currentStep + 1} of {totalSteps}
          </span>
        )}
      </div>
      {!isSingleQuestion && (
        <div className="question-stepper flex justify-center gap-2 px-3.5 pt-2.5 pb-1">
          {request.questions.map((_, idx) => (
            <div
              key={idx}
              className={`w-2 h-2 rounded-full transition-[background,transform] duration-200 ${
                idx === currentStep
                  ? 'bg-accent scale-[1.35]'
                  : idx < currentStep
                    ? 'bg-accent'
                    : 'bg-border'
              }`}
            />
          ))}
        </div>
      )}
      <div key={currentQuestion.question} className="question-item px-3.5 py-3">
        <div className="inline-block bg-border text-[#aaa] text-[0.75em] px-2 py-0.5 rounded mb-1.5">{currentQuestion.header}</div>
        <div className="text-[0.95em] mb-2.5 text-[#ddd]">{currentQuestion.question}</div>
        <div className="flex flex-col gap-1.5">
          {currentQuestion.options.map((opt) => {
            const selected = selections[currentQuestion.question]?.has(opt.label)
            return (
              <button
                key={opt.label}
                className={`flex flex-col items-start gap-0.5 px-3 py-2 rounded-md border text-left cursor-pointer transition-[border-color,background] duration-150 w-full ${
                  selected
                    ? 'border-accent bg-[#2a2a4a] text-[#ccc]'
                    : 'border-border bg-[#222] text-[#ccc] hover:border-accent hover:bg-border-subtle'
                }`}
                onClick={() => toggleOption(currentQuestion.question, opt.label, currentQuestion.multiSelect)}
              >
                <span className="font-semibold text-[0.9em] text-[#eee]">{opt.label}</span>
                <span className="text-[0.8em] text-text-muted">{opt.description}</span>
              </button>
            )
          })}
          <button
            className={`flex flex-col items-start gap-0.5 px-3 py-2 rounded-md border border-dashed text-left cursor-pointer transition-[border-color,background] duration-150 w-full ${
              showOther[currentQuestion.question]
                ? 'border-accent bg-[#2a2a4a] text-[#ccc]'
                : 'border-border bg-[#222] text-[#ccc] hover:border-accent hover:bg-border-subtle'
            }`}
            onClick={() => toggleOther(currentQuestion.question, currentQuestion.multiSelect)}
          >
            <span className="font-semibold text-[0.9em] text-[#eee]">Other</span>
            <span className="text-[0.8em] text-text-muted">Provide a custom answer</span>
          </button>
        </div>
        {showOther[currentQuestion.question] && (
          <textarea
            className="w-full mt-2 px-2 py-2 bg-[#1a1a1a] border border-[#444] rounded-md text-[#ddd] font-[inherit] text-[0.9em] resize-y focus:outline-none focus:border-accent"
            placeholder="Type your answer..."
            value={otherTexts[currentQuestion.question] || ''}
            onChange={(e) => setOtherTexts((prev) => ({ ...prev, [currentQuestion.question]: e.target.value }))}
            rows={2}
          />
        )}
      </div>
      <div className="flex gap-2 px-3.5 py-2.5 justify-end border-t border-border-subtle max-[768px]:flex-wrap max-[768px]:gap-1.5 max-[768px]:px-3 max-[768px]:py-2">
        {!isFirstStep && (
          <button className="border-none rounded-md px-4 py-2 text-[0.9em] font-medium cursor-pointer transition-[background] duration-150 bg-[#555] text-white hover:bg-text-dim disabled:opacity-40 disabled:cursor-not-allowed max-[768px]:min-h-10" onClick={handleBack}>
            Back
          </button>
        )}
        {isLastStep ? (
          <button
            className="border-none rounded-md px-4 py-2 text-[0.9em] font-medium cursor-pointer transition-[background] duration-150 bg-success text-white hover:bg-[#43a047] disabled:opacity-40 disabled:cursor-not-allowed max-[768px]:min-h-10"
            onClick={handleSubmit}
            disabled={!allAnswered}
          >
            Submit
          </button>
        ) : (
          <button
            className="border-none rounded-md px-4 py-2 text-[0.9em] font-medium cursor-pointer transition-[background] duration-150 bg-success text-white hover:bg-[#43a047] disabled:opacity-40 disabled:cursor-not-allowed max-[768px]:min-h-10"
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
