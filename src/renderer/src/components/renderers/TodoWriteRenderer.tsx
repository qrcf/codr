import { CheckCircle2, Loader2, Circle } from 'lucide-react'
import type { ToolCallInfo } from '../../types'

interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm: string
}

export function TodoWriteRenderer({ tool }: { tool: ToolCallInfo }) {
  const todos = (tool.input.todos as TodoItem[]) || []
  if (todos.length === 0) return null

  return (
    <div className="px-[10px] py-2 flex flex-col gap-[2px] border-t border-[#3a3a4a]">
      {todos.map((todo, i) => (
        <div key={i} className="flex items-center gap-2 px-[6px] py-[3px] rounded text-[0.88em] leading-[1.4]">
          <span className={`w-[18px] text-center flex-shrink-0 text-[0.9em] ${todo.status === 'completed' ? 'text-[#4caf50]' : todo.status === 'in_progress' ? 'text-[#f0c040]' : 'text-[#666]'}`}>
            {todo.status === 'completed' ? <CheckCircle2 size={14} /> :
             todo.status === 'in_progress' ? <Loader2 size={14} className="animate-spin" /> : <Circle size={14} />}
          </span>
          <span className={todo.status === 'completed' ? 'text-[#777] line-through' : todo.status === 'in_progress' ? 'text-[#e0e0e0]' : 'text-[#999]'}>
            {todo.status === 'in_progress' ? todo.activeForm : todo.content}
          </span>
        </div>
      ))}
    </div>
  )
}
