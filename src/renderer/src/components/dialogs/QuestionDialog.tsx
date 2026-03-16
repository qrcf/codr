import { useRef, useState } from 'react'

export function QuestionDialog({ request, onRespond }: {
  request: { id: number; questions: QuestionItem[] }
  onRespond: (id: number, answers: Record<string, string>) => void
}) {
  const [selections, setSelections] = useState<Record<string, Set<string>>>({})
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({})
  const [currentStep, setCurrentStep] = useState(0)
  const otherInputRef = useRef<HTMLInputElement>(null)

  const totalSteps = request.questions.length
  const isFirstStep = currentStep === 0
  const isLastStep = currentStep === totalSteps - 1
  const isSingleQuestion = totalSteps === 1
  const currentQuestion = request.questions[currentStep]

  const hasDescriptions = currentQuestion.options.every((o) => o.description?.trim())

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
      return { ...prev, [question]: next }
    })
  }

  const handleOtherInput = (question: string, value: string, multiSelect: boolean) => {
    setOtherTexts((prev) => ({ ...prev, [question]: value }))
    setSelections((prev) => {
      const current = prev[question] || new Set<string>()
      const next = new Set(current)
      if (value.trim()) {
        if (!multiSelect) next.clear()
        next.add('__other__')
      } else {
        next.delete('__other__')
      }
      return { ...prev, [question]: next }
    })
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

  const currentStepAnswered = (() => {
    const sel = selections[currentQuestion.question]
    return !!(sel && sel.size > 0 && (!sel.has('__other__') || otherTexts[currentQuestion.question]?.trim()))
  })()

  const allAnswered = request.questions.every((q) => {
    const sel = selections[q.question]
    return !!(sel && sel.size > 0 && (!sel.has('__other__') || otherTexts[q.question]?.trim()))
  })

  return (
    <div className="flex flex-col">
      {/* Step dots */}
      {!isSingleQuestion && (
        <div className="flex justify-center gap-1.5 pt-3 pb-1">
          {request.questions.map((_, idx) => (
            <div
              key={idx}
              className={`rounded-full transition-all duration-200 ${
                idx === currentStep
                  ? 'w-4 h-1.5 bg-accent'
                  : idx < currentStep
                    ? 'w-1.5 h-1.5 bg-accent/50'
                    : 'w-1.5 h-1.5 bg-border'
              }`}
            />
          ))}
        </div>
      )}

      {/* Question body */}
      <div key={currentQuestion.question} className="px-4 pt-3 pb-2">
        {currentQuestion.header && (
          <div className="text-[0.7em] font-medium tracking-wider uppercase text-text-muted mb-1.5">
            {currentQuestion.header}
          </div>
        )}
        <div className="text-[0.92em] text-text-primary mb-3 leading-snug">{currentQuestion.question}</div>

        {/* Options */}
        <div className={`flex ${hasDescriptions ? 'flex-col gap-1.5' : 'flex-wrap gap-2'}`}>
          {currentQuestion.options.map((opt) => {
            const selected = !!selections[currentQuestion.question]?.has(opt.label)
            return (
              <button
                key={opt.label}
                onClick={() => toggleOption(currentQuestion.question, opt.label, currentQuestion.multiSelect)}
                className={`text-left transition-all duration-150 cursor-pointer border-none rounded-lg
                  ${hasDescriptions
                    ? 'w-full px-3 py-2.5'
                    : 'px-3 py-1.5'
                  }
                  ${selected
                    ? 'bg-accent text-white shadow-sm'
                    : 'bg-border-subtle text-text-primary hover:bg-border'
                  }`}
              >
                <div className={`font-medium text-[0.88em] ${selected ? 'text-white' : 'text-text-primary'}`}>
                  {opt.label}
                </div>
                {hasDescriptions && opt.description && (
                  <div className={`text-[0.78em] mt-0.5 ${selected ? 'text-white/70' : 'text-text-muted'}`}>
                    {opt.description}
                  </div>
                )}
              </button>
            )
          })}
        </div>

        {/* Other — inline text input, type-to-select */}
        <div className={`mt-2.5 flex items-center gap-2 px-3 py-2 rounded-lg border transition-all duration-150 ${
          selections[currentQuestion.question]?.has('__other__')
            ? 'border-accent/50 bg-accent/8'
            : 'border-border bg-border-subtle'
        }`}>
          <input
            ref={otherInputRef}
            type="text"
            value={otherTexts[currentQuestion.question] || ''}
            onChange={(e) => handleOtherInput(currentQuestion.question, e.target.value, currentQuestion.multiSelect)}
            placeholder="Or type your own…"
            className="flex-1 bg-transparent border-none outline-none text-[0.88em] text-text-primary placeholder:text-text-dim font-[inherit]"
          />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-t border-border-subtle mt-1">
        <div>
          {!isSingleQuestion && (
            <span className="text-[0.75em] text-text-dim tabular-nums">
              {currentStep + 1} / {totalSteps}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isFirstStep && (
            <button
              className="px-3 py-1.5 text-[0.82em] font-medium text-text-muted hover:text-text-primary transition-colors cursor-pointer border-none bg-transparent"
              onClick={() => setCurrentStep(currentStep - 1)}
            >
              Back
            </button>
          )}
          {isLastStep ? (
            <button
              className="px-4 py-1.5 text-[0.82em] font-medium rounded-full cursor-pointer border-none transition-all duration-150 bg-accent text-white hover:bg-accent-hover disabled:opacity-35 disabled:cursor-not-allowed"
              onClick={handleSubmit}
              disabled={!allAnswered}
            >
              Submit
            </button>
          ) : (
            <button
              className="px-4 py-1.5 text-[0.82em] font-medium rounded-full cursor-pointer border-none transition-all duration-150 bg-accent text-white hover:bg-accent-hover disabled:opacity-35 disabled:cursor-not-allowed"
              onClick={() => setCurrentStep(currentStep + 1)}
              disabled={!currentStepAnswered}
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
