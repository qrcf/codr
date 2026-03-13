import type { ToolCallInfo } from '../../types'

export function AskUserQuestionRenderer({ tool }: { tool: ToolCallInfo }) {
  const questions = (tool.input.questions as QuestionItem[]) || []
  const answers = (tool.input.answers as Record<string, string>) || {}

  return (
    <div className="py-2">
      {questions.map((q) => {
        const answer = answers[q.question]
        return (
          <div key={q.question} className="py-1">
            <div className="inline-block bg-[#333] text-[#aaa] text-[0.75em] px-2 py-[2px] rounded mb-[6px]">{q.header}</div>
            <div className="text-[0.95em] mb-[10px] text-[#ddd]">{q.question}</div>
            <div className="flex flex-col gap-[6px]">
              {q.options.map((opt) => {
                const isSelected = answer?.split(', ').includes(opt.label)
                return (
                  <div
                    key={opt.label}
                    className={`flex flex-col gap-[2px] px-3 py-2 border rounded-md ${isSelected ? 'border-[#8142c7] bg-[#2a2a4a] text-[#ccc]' : 'border-[#2a2a2a] bg-[#1a1a1a] text-[#777]'}`}
                  >
                    <span className={`font-semibold text-[0.9em] ${isSelected ? 'text-[#eee]' : ''}`}>{opt.label}</span>
                    <span className="text-[0.8em] opacity-80">{opt.description}</span>
                  </div>
                )
              })}
            </div>
            {answer && !q.options.some((o) => answer.split(', ').includes(o.label)) && (
              <div className="mt-2 px-3 py-2 border border-[#8142c7] rounded-md bg-[#2a2a4a] text-[#ccc] text-[0.9em]">
                Answer: {answer}
              </div>
            )}
            {tool.status === 'running' && !answer && (
              <div className="text-[#666] italic text-[0.85em] mt-[6px]">Waiting for answer...</div>
            )}
          </div>
        )
      })}
    </div>
  )
}
