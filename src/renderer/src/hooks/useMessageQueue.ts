import { useState, useRef, useCallback } from 'react'

export interface QueuedMessage {
  id: string
  prompt: string           // composed prompt with @file/@docs baked in
  rawInput: string         // display text (just user's typed text)
  selectedFiles: string[]
  selectedDocs: DocSource[]
  attachments: AttachmentMeta[]
}

export function useMessageQueue() {
  const [queue, setQueue] = useState<QueuedMessage[]>([])
  const queueRef = useRef<QueuedMessage[]>([])

  const sync = (next: QueuedMessage[]) => {
    queueRef.current = next
    setQueue(next)
  }

  const enqueue = useCallback((msg: QueuedMessage) => {
    const next = [...queueRef.current, msg]
    sync(next)
  }, [])

  const dequeue = useCallback((): QueuedMessage | undefined => {
    const current = queueRef.current
    if (current.length === 0) return undefined
    const [first, ...rest] = current
    sync(rest)
    return first
  }, [])

  const remove = useCallback((id: string) => {
    const next = queueRef.current.filter(m => m.id !== id)
    sync(next)
  }, [])

  const clear = useCallback(() => {
    sync([])
  }, [])

  return { queue, queueRef, enqueue, dequeue, remove, clear }
}
