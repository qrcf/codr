interface ToolCallSnapshot {
  kind?: string
  title?: string
  rawInput?: unknown
  rawOutput?: unknown
  meta?: Record<string, unknown>
}

interface ResolvedToolCallSnapshot {
  kind: string
  title: string
  rawInput?: unknown
  rawOutput?: unknown
  meta?: Record<string, unknown>
}

export class ToolCallState {
  private readonly snapshots = new Map<string, ToolCallSnapshot>()

  remember(toolCallId: string, snapshot: ToolCallSnapshot): ToolCallSnapshot {
    const current = this.snapshots.get(toolCallId) || {}
    const next = {
      ...current,
      ...(snapshot.kind !== undefined ? { kind: snapshot.kind } : {}),
      ...(snapshot.title !== undefined ? { title: snapshot.title } : {}),
      ...(snapshot.rawInput !== undefined ? { rawInput: snapshot.rawInput } : {}),
      ...(snapshot.rawOutput !== undefined ? { rawOutput: snapshot.rawOutput } : {}),
      ...(snapshot.meta !== undefined ? { meta: snapshot.meta } : {}),
    }
    this.snapshots.set(toolCallId, next)
    return next
  }

  resolve(toolCallId: string, snapshot: ToolCallSnapshot): ResolvedToolCallSnapshot {
    const merged = this.remember(toolCallId, snapshot)
    return {
      kind: merged.kind || 'other',
      title: merged.title || '',
      rawInput: merged.rawInput,
      rawOutput: merged.rawOutput,
      meta: merged.meta,
    }
  }

  clear(): void {
    this.snapshots.clear()
  }
}
