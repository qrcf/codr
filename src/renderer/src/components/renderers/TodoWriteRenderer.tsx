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
    <div className="todo-list">
      {todos.map((todo, i) => (
        <div key={i} className={`todo-item todo-${todo.status}`}>
          <span className="todo-indicator">
            {todo.status === 'completed' ? <CheckCircle2 size={14} /> :
             todo.status === 'in_progress' ? <Loader2 size={14} className="spin" /> : <Circle size={14} />}
          </span>
          <span className="todo-text">
            {todo.status === 'in_progress' ? todo.activeForm : todo.content}
          </span>
        </div>
      ))}
    </div>
  )
}
