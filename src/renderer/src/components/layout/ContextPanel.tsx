import { CheckCircle2, Loader2, Circle, PanelRightClose, PanelRightOpen, X, FileText } from 'lucide-react'
import type { TodoItem } from '../../hooks/useLatestTodos'
import type { PlanReviewState } from '../../types'

interface ContextPanelProps {
  todos: TodoItem[] | null
  approvedPlan: { content: string; filePath: string } | null
  pendingPlan: PlanReviewState | null
  onShowPlan: () => void
  isNarrow: boolean
  isExpanded: boolean
  onToggleExpand: () => void
}

function PlanSection({ approvedPlan, pendingPlan, onShowPlan }: {
  approvedPlan: { content: string; filePath: string } | null
  pendingPlan: PlanReviewState | null
  onShowPlan: () => void
}) {
  // Show approved plan if available, otherwise show pending plan info
  if (approvedPlan) {
    const fileName = approvedPlan.filePath.split('/').pop() || 'plan.md'
    return (
      <div className="px-3 py-3 border-b border-border">
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#78c0a8] text-[#1a1a1a] text-[0.65em] font-bold shrink-0">P</span>
          <span className="text-[0.8em] font-medium text-[#78c0a8]">Plan</span>
          <span className="text-[0.65em] text-[#4caf50] font-medium">Approved</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-['SF_Mono','Fira_Code',monospace] text-[0.72em] text-text-dim truncate flex-1">{fileName}</span>
          <button
            className="text-[0.72em] text-[#78c0a8] hover:text-[#9dd4c0] bg-transparent border border-[#3a4a4a] rounded px-2 py-0.5 cursor-pointer transition-colors shrink-0"
            onClick={onShowPlan}
          >
            View
          </button>
        </div>
      </div>
    )
  }

  if (pendingPlan) {
    const fileName = pendingPlan.planFilePath.split('/').pop() || 'plan.md'
    return (
      <div className="px-3 py-3 border-b border-border">
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#f0c040] text-[#1a1a1a] text-[0.65em] font-bold shrink-0">P</span>
          <span className="text-[0.8em] font-medium text-[#f0c040]">Plan</span>
          <span className="text-[0.65em] text-[#f0c040] font-medium">Pending Review</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-['SF_Mono','Fira_Code',monospace] text-[0.72em] text-text-dim truncate flex-1">{fileName}</span>
        </div>
      </div>
    )
  }

  // Empty state
  return (
    <div className="px-3 py-3 border-b border-border">
      <div className="flex items-center gap-2">
        <FileText size={13} className="text-[#555] shrink-0" />
        <span className="text-[0.8em] text-[#555]">No plan</span>
      </div>
    </div>
  )
}

function TodosSection({ todos }: { todos: TodoItem[] }) {
  const completed = todos.filter(t => t.status === 'completed').length
  return (
    <div className="px-3 py-3 flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[0.8em] font-medium text-text-muted">Tasks</span>
        <span className="text-[0.7em] text-text-dim">{completed}/{todos.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto flex flex-col gap-[2px]">
        {todos.map((todo, i) => (
          <div key={i} className="flex items-start gap-1.5 py-[3px] text-[0.8em] leading-[1.4]">
            <span className={`w-[16px] mt-[1px] text-center flex-shrink-0 ${todo.status === 'completed' ? 'text-[#4caf50]' : todo.status === 'in_progress' ? 'text-[#f0c040]' : 'text-[#555]'}`}>
              {todo.status === 'completed' ? <CheckCircle2 size={13} /> :
               todo.status === 'in_progress' ? <Loader2 size={13} className="animate-spin" /> : <Circle size={13} />}
            </span>
            <span className={`${todo.status === 'completed' ? 'text-[#666] line-through' : todo.status === 'in_progress' ? 'text-[#ddd]' : 'text-[#888]'}`}>
              {todo.status === 'in_progress' ? todo.activeForm : todo.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PanelContent({ todos, approvedPlan, pendingPlan, onShowPlan }: Pick<ContextPanelProps, 'todos' | 'approvedPlan' | 'pendingPlan' | 'onShowPlan'>) {
  return (
    <>
      <PlanSection approvedPlan={approvedPlan} pendingPlan={pendingPlan} onShowPlan={onShowPlan} />
      {todos && <TodosSection todos={todos} />}
    </>
  )
}

export function ContextPanel({ todos, approvedPlan, pendingPlan, onShowPlan, isNarrow, isExpanded, onToggleExpand }: ContextPanelProps) {
  // Collapsed button in narrow mode
  if (isNarrow && !isExpanded) {
    const pendingCount = todos ? todos.filter(t => t.status !== 'completed').length : 0
    const hasContent = !!(todos || approvedPlan || pendingPlan)
    if (!hasContent) return null

    return (
      <button
        className="absolute right-3 top-3 z-30 flex items-center gap-1 bg-bg-secondary border border-border rounded-md px-2 py-1.5 cursor-pointer hover:bg-border-subtle transition-colors text-text-muted"
        onClick={onToggleExpand}
        title="Show context panel"
      >
        <PanelRightOpen size={14} />
        {pendingCount > 0 && (
          <span className="text-[0.7em] bg-[#f0c040] text-[#1a1a1a] rounded-full w-4 h-4 flex items-center justify-center font-bold">{pendingCount}</span>
        )}
        {(approvedPlan || pendingPlan) && !todos && (
          <span className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-full ${approvedPlan ? 'bg-[#78c0a8]' : 'bg-[#f0c040]'} text-[#1a1a1a] text-[0.55em] font-bold`}>P</span>
        )}
      </button>
    )
  }

  // Overlay in narrow mode (expanded)
  if (isNarrow && isExpanded) {
    return (
      <div className="absolute right-0 top-0 bottom-0 w-[280px] z-40 bg-bg-primary border-l border-border flex flex-col shadow-[-4px_0_12px_rgba(0,0,0,0.3)] transition-transform duration-200">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
          <span className="text-[0.8em] font-medium text-text-muted">Context</span>
          <button
            className="bg-transparent border-none text-text-dim hover:text-text-muted cursor-pointer p-0.5"
            onClick={onToggleExpand}
          >
            <X size={14} />
          </button>
        </div>
        <PanelContent todos={todos} approvedPlan={approvedPlan} pendingPlan={pendingPlan} onShowPlan={onShowPlan} />
      </div>
    )
  }

  // Inline panel in wide mode
  return (
    <div className="w-[280px] shrink-0 border-l border-border bg-bg-primary flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-[0.8em] font-medium text-text-muted">Context</span>
        <button
          className="bg-transparent border-none text-text-dim hover:text-text-muted cursor-pointer p-0.5"
          onClick={onToggleExpand}
          title="Collapse panel"
        >
          <PanelRightClose size={14} />
        </button>
      </div>
      <PanelContent todos={todos} approvedPlan={approvedPlan} pendingPlan={pendingPlan} onShowPlan={onShowPlan} />
    </div>
  )
}
