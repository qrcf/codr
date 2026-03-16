import type { ComponentType } from 'react'
import type { ToolCallInfo } from '../../types'
import { TodoWriteRenderer } from './TodoWriteRenderer'
import { BashRenderer } from './BashRenderer'
import { EditRenderer } from './EditRenderer'
import { ReadRenderer } from './ReadRenderer'
import { WriteRenderer } from './WriteRenderer'
import { GrepRenderer } from './GrepRenderer'
import { GlobRenderer } from './GlobRenderer'
import { AgentRenderer } from './AgentRenderer'
import { EnterPlanModeRenderer, ExitPlanModeRenderer } from './PlanModeRenderer'
import { AskUserQuestionRenderer } from './AskUserQuestionRenderer'

export type ToolRenderer = ComponentType<{ tool: ToolCallInfo }>

export const toolRenderers: Record<string, ToolRenderer> = {
  TodoWrite: TodoWriteRenderer,
  Bash: BashRenderer,
  Edit: EditRenderer,
  Read: ReadRenderer,
  Write: WriteRenderer,
  Grep: GrepRenderer,
  Glob: GlobRenderer,
  Agent: AgentRenderer,
  EnterPlanMode: EnterPlanModeRenderer,
  ExitPlanMode: ExitPlanModeRenderer,
  AskUserQuestion: AskUserQuestionRenderer,
}
