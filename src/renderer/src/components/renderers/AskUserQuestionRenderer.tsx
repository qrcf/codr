import type { ToolCallInfo } from '../../types'

export function AskUserQuestionRenderer({ tool }: { tool: ToolCallInfo }) {
  const questions = (tool.input.questions as QuestionItem[]) || []
  const answers = (tool.input.answers as Record<string, string>) || {}

  return (
    <div className="ask-question-renderer">
      {questions.map((q) => {
        const answer = answers[q.question]
        return (
          <div key={q.question} className="ask-question-item">
            <div className="ask-question-badge">{q.header}</div>
            <div className="ask-question-text">{q.question}</div>
            <div className="ask-question-options">
              {q.options.map((opt) => {
                const isSelected = answer?.split(', ').includes(opt.label)
                return (
                  <div
                    key={opt.label}
                    className={`ask-question-option${isSelected ? ' selected' : ''}`}
                  >
                    <span className="option-label">{opt.label}</span>
                    <span className="option-desc">{opt.description}</span>
                  </div>
                )
              })}
            </div>
            {answer && !q.options.some((o) => answer.split(', ').includes(o.label)) && (
              <div className="ask-question-custom-answer">
                Answer: {answer}
              </div>
            )}
            {tool.status === 'running' && !answer && (
              <div className="ask-question-waiting">Waiting for answer...</div>
            )}
          </div>
        )
      })}
    </div>
  )
}
