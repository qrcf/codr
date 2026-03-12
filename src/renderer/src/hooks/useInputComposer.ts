import { useState, useRef, useEffect, useCallback } from 'react'
import { getMentionItemCount, resolveMentionIndex } from '../components/FileMentionDropdown'
import type { useDocsAPI } from './useDocsAPI'

interface UseInputComposerParams {
  onSend: () => void
  docsAPI: ReturnType<typeof useDocsAPI>
  projectFolderRef: React.MutableRefObject<string | null>
  setMode: React.Dispatch<React.SetStateAction<'plan' | 'code' | 'ask'>>
}

export function useInputComposer({
  onSend,
  docsAPI,
  projectFolderRef,
  setMode,
}: UseInputComposerParams) {
  const [input, setInput] = useState('')
  const [mentionActive, setMentionActive] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionStart, setMentionStart] = useState(0)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [fileCache, setFileCache] = useState<string[]>([])
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [selectedDocs, setSelectedDocs] = useState<DocSource[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Textarea auto-resize
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    const clamped = Math.min(ta.scrollHeight, 240)
    ta.style.height = clamped + 'px'
    ta.style.overflowY = ta.scrollHeight > 240 ? 'auto' : 'hidden'
  }, [input])

  const handleMentionSelect = useCallback((file: string) => {
    const before = input.slice(0, mentionStart)
    const after = input.slice(mentionStart + mentionQuery.length + 1)
    setInput(before + after)
    setSelectedFiles(prev => prev.includes(file) ? prev : [...prev, file])
    setMentionActive(false)
    setMentionQuery('')
    setMentionIndex(0)
    textareaRef.current?.focus()
  }, [input, mentionStart, mentionQuery])

  const handleDocMentionSelect = useCallback((doc: DocSource) => {
    const before = input.slice(0, mentionStart)
    const after = input.slice(mentionStart + mentionQuery.length + 1)
    setInput(before + after)
    setSelectedDocs(prev => prev.some(d => d.id === doc.id) ? prev : [...prev, doc])
    setMentionActive(false)
    setMentionQuery('')
    setMentionIndex(0)
    textareaRef.current?.focus()
  }, [input, mentionStart, mentionQuery])

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    const cursor = e.target.selectionStart
    setInput(value)

    if (mentionActive) {
      const textAfterAt = value.slice(mentionStart + 1, cursor)
      if (textAfterAt.includes(' ') || textAfterAt.includes('\n') || cursor <= mentionStart) {
        setMentionActive(false)
        setMentionQuery('')
        setMentionIndex(0)
      } else {
        setMentionQuery(textAfterAt)
        setMentionIndex(0)
      }
    } else {
      const charBeforeCursor = value[cursor - 1]
      const charBeforeAt = value[cursor - 2]
      if (charBeforeCursor === '@' && (cursor === 1 || charBeforeAt === ' ' || charBeforeAt === '\n' || charBeforeAt === undefined)) {
        setMentionActive(true)
        setMentionStart(cursor - 1)
        setMentionQuery('')
        setMentionIndex(0)
        if (fileCache.length === 0) {
          window.claude.listFiles().then(setFileCache).catch(() => {})
        }
        docsAPI.refresh()
      }
    }
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const files = e.dataTransfer.files
    if (!files.length) return
    const paths: string[] = []
    const folder = projectFolderRef.current
    for (let i = 0; i < files.length; i++) {
      const filePath = (files[i] as File & { path: string }).path
      if (!filePath) continue
      if (folder && filePath.startsWith(folder + '/')) {
        paths.push(filePath.slice(folder.length + 1))
      } else {
        paths.push(filePath)
      }
    }
    if (paths.length) {
      setSelectedFiles(prev => {
        const set = new Set(prev)
        for (const p of paths) set.add(p)
        return [...set]
      })
    }
    textareaRef.current?.focus()
  }, [projectFolderRef])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const files = e.clipboardData.files
    if (!files.length) return
    e.preventDefault()
    const paths: string[] = []
    const folder = projectFolderRef.current
    for (let i = 0; i < files.length; i++) {
      const filePath = (files[i] as File & { path: string }).path
      if (!filePath) continue
      if (folder && filePath.startsWith(folder + '/')) {
        paths.push(filePath.slice(folder.length + 1))
      } else {
        paths.push(filePath)
      }
    }
    if (paths.length) {
      setSelectedFiles(prev => {
        const set = new Set(prev)
        for (const p of paths) set.add(p)
        return [...set]
      })
    }
  }, [projectFolderRef])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      setMode(prev => {
        const modes = ['plan', 'code', 'ask'] as const
        const idx = modes.indexOf(prev)
        return modes[(idx + 1) % 3]
      })
      return
    }

    if (mentionActive) {
      const totalItems = getMentionItemCount(fileCache, docsAPI.sources, mentionQuery)
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex((i) => Math.min(i + 1, totalItems - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const resolved = resolveMentionIndex(fileCache, docsAPI.sources, mentionQuery, mentionIndex)
        if (resolved?.type === 'file') {
          handleMentionSelect(resolved.file)
        } else if (resolved?.type === 'doc') {
          handleDocMentionSelect(resolved.doc)
        }
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMentionActive(false)
        setMentionQuery('')
        setMentionIndex(0)
        return
      }
    }

    if (e.key === 'Backspace' && !input && selectedFiles.length > 0) {
      setSelectedFiles(prev => prev.slice(0, -1))
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend()
    }
  }

  const resetInput = useCallback(() => {
    setInput('')
    setSelectedFiles([])
    setSelectedDocs([])
  }, [])

  return {
    input,
    setInput,
    textareaRef,
    mentionActive,
    mentionQuery,
    mentionIndex,
    fileCache,
    selectedFiles,
    setSelectedFiles,
    selectedDocs,
    setSelectedDocs,
    isDragOver,
    handleInputChange,
    handleMentionSelect,
    handleDocMentionSelect,
    handleKeyDown,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handlePaste,
    resetInput,
  }
}
