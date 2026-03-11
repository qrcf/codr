import type { ComponentType } from 'react'
import type { ToolCallInfo } from '../types'
import { TodoWriteRenderer } from './renderers/TodoWriteRenderer'
import { BashRenderer } from './renderers/BashRenderer'
import { EditRenderer } from './renderers/EditRenderer'
import { ReadRenderer } from './renderers/ReadRenderer'
import { WriteRenderer } from './renderers/WriteRenderer'
import { GrepRenderer } from './renderers/GrepRenderer'
import { GlobRenderer } from './renderers/GlobRenderer'
import { AgentRenderer } from './renderers/AgentRenderer'

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
}
