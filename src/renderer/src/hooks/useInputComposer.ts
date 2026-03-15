import { useState, useRef, useEffect, useCallback } from 'react'
import { getMentionItemCount, resolveMentionIndex } from '../utils/mentionUtils'
import type { useDocsAPI } from './useDocsAPI'
import { useCodr } from './useCodr'

// Extensions that should always become binary attachments (not @file text refs)
const ATTACHMENT_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.heic',
  '.pdf',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.mp3', '.wav', '.ogg', '.mp4', '.mov', '.avi', '.mkv',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
])

function shouldStoreAsAttachment(filePath: string, projectFolder: string | null): boolean {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  if (ATTACHMENT_EXTENSIONS.has(ext)) return true
  // Files outside the project folder are always attachments
  return !!(projectFolder && !filePath.startsWith(projectFolder + '/'))
}

interface UseInputComposerParams {
  onSend: () => void
  docsAPI: ReturnType<typeof useDocsAPI>
  projectFolderRef: React.MutableRefObject<string | null>
}

export function useInputComposer({
  onSend,
  docsAPI,
  projectFolderRef,
}: UseInputComposerParams) {
  const codr = useCodr()
  const [input, setInput] = useState('')
  const [mentionActive, setMentionActive] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionStart, setMentionStart] = useState(0)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [fileCache, setFileCache] = useState<string[]>([])
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [selectedDocs, setSelectedDocs] = useState<DocSource[]>([])
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [refFinderOpen, setRefFinderOpen] = useState(false)
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
        // Always re-fetch so the cache stays current when switching projects
        codr.listFiles(projectFolderRef.current || undefined).then(setFileCache).catch(() => {})
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

  const resolveFilePath = useCallback((file: File): string => {
    if (codr.getPathForFile) return codr.getPathForFile(file)
    return (file as File & { path?: string }).path || ''
  }, [codr])

  const addFilePaths = useCallback((filePaths: string[]) => {
    const folder = projectFolderRef.current
    const paths: string[] = []
    for (const filePath of filePaths) {
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

  // Store files as persistent attachments (images, PDFs, binary files, files outside project)
  const addAttachments = useCallback(async (filePaths: string[]) => {
    if (!codr.storeAttachments || !filePaths.length) return
    try {
      const stored = await codr.storeAttachments(filePaths)
      if (stored.length) {
        setAttachments(prev => {
          const existingIds = new Set(prev.map(a => a.id))
          const newAtts = stored.filter(a => !existingIds.has(a.id))
          return newAtts.length ? [...prev, ...newAtts] : prev
        })
      }
    } catch {
      // Storage failed — silently ignore
    }
  }, [codr])

  // Store a raw buffer as attachment (for clipboard screenshot paste)
  const addAttachmentBuffer = useCallback(async (buffer: ArrayBuffer, filename: string) => {
    if (!codr.storeAttachmentBuffer) return
    try {
      const stored = await codr.storeAttachmentBuffer(new Uint8Array(buffer), filename)
      setAttachments(prev => [...prev, stored])
    } catch {
      // Storage failed — silently ignore
    }
  }, [codr])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const files = e.dataTransfer.files
    if (!files.length) return
    const attachmentPaths: string[] = []
    const textPaths: string[] = []
    for (let i = 0; i < files.length; i++) {
      const fp = resolveFilePath(files[i])
      if (!fp) continue
      if (shouldStoreAsAttachment(fp, projectFolderRef.current)) {
        attachmentPaths.push(fp)
      } else {
        textPaths.push(fp)
      }
    }
    if (textPaths.length) addFilePaths(textPaths)
    if (attachmentPaths.length) addAttachments(attachmentPaths)
    textareaRef.current?.focus()
  }, [resolveFilePath, addFilePaths, addAttachments, projectFolderRef])

  // Scan the textarea backward from the cursor for a @word pattern and activate mention mode.
  // Used after paste to handle pasted @ symbols and paths.
  const activateMentionFromCursor = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    const value = ta.value
    const cursor = ta.selectionStart
    let atPos = -1
    for (let i = cursor - 1; i >= 0; i--) {
      const ch = value[i]
      if (ch === ' ' || ch === '\n') break
      if (ch === '@') {
        if (i === 0 || value[i - 1] === ' ' || value[i - 1] === '\n') atPos = i
        break
      }
    }
    if (atPos === -1) return
    const query = value.slice(atPos + 1, cursor)
    if (query.includes(' ') || query.includes('\n')) return
    setMentionActive(true)
    setMentionStart(atPos)
    setMentionQuery(query)
    setMentionIndex(0)
    codr.listFiles(projectFolderRef.current || undefined).then(setFileCache).catch(() => {})
    docsAPI.refresh()
  }, [codr, projectFolderRef, docsAPI])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const pastedText = e.clipboardData.getData('text')
    const files = e.clipboardData.files
    if (files.length) {
      // Files from clipboard (e.g. screenshot paste)
      e.preventDefault()
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const fp = resolveFilePath(file)
        if (fp && !shouldStoreAsAttachment(fp, projectFolderRef.current)) {
          // Text file inside project — use old @file path
          addFilePaths([fp])
        } else if (fp) {
          // Has a path but should be stored as attachment
          addAttachments([fp])
        } else {
          // No path (e.g. screenshot from clipboard) — read as buffer
          file.arrayBuffer().then(buf => {
            const name = file.name || `paste-${Date.now()}.png`
            addAttachmentBuffer(buf, name)
          })
        }
      }
      return
    }

    // No File objects — try native pasteboard for Finder-copied files
    if (codr.readClipboardFilePaths) {
      codr.readClipboardFilePaths().then(nativePaths => {
        if (nativePaths.length) {
          const attachmentPaths: string[] = []
          const textPaths: string[] = []
          for (const fp of nativePaths) {
            if (shouldStoreAsAttachment(fp, projectFolderRef.current)) {
              attachmentPaths.push(fp)
            } else {
              textPaths.push(fp)
            }
          }
          if (textPaths.length) addFilePaths(textPaths)
          if (attachmentPaths.length) addAttachments(attachmentPaths)
          return
        }
        // No native paths — check if pasted text places cursor after a @-mention
        if (pastedText?.includes('@')) requestAnimationFrame(activateMentionFromCursor)
      })
    } else if (pastedText?.includes('@')) {
      requestAnimationFrame(activateMentionFromCursor)
    }
  }, [codr, resolveFilePath, addFilePaths, addAttachments, addAttachmentBuffer, activateMentionFromCursor, projectFolderRef])

  const handlePlusClick = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    const newInput = input.endsWith(' ') || input === '' ? input + '@' : input + ' @'
    setInput(newInput)
    const atPos = newInput.length - 1
    setMentionActive(true)
    setMentionStart(atPos)
    setMentionQuery('')
    setMentionIndex(0)
    codr.listFiles(projectFolderRef.current || undefined).then(setFileCache).catch(() => {})
    docsAPI.refresh()
    setTimeout(() => {
      ta.focus()
      ta.setSelectionRange(newInput.length, newInput.length)
    }, 0)
  }, [codr, input, projectFolderRef, docsAPI])

  const handleFindReferencesSelect = useCallback(() => {
    // Remove the @ from input
    const before = input.slice(0, mentionStart)
    const after = input.slice(mentionStart + mentionQuery.length + 1)
    setInput(before + after)
    setMentionActive(false)
    setMentionQuery('')
    setMentionIndex(0)
    setRefFinderOpen(true)
  }, [input, mentionStart, mentionQuery])

  const handleRefFinderApprove = useCallback((files: string[]) => {
    setSelectedFiles(prev => {
      const set = new Set(prev)
      for (const f of files) set.add(f)
      return [...set]
    })
    setRefFinderOpen(false)
    textareaRef.current?.focus()
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
        if (resolved?.type === 'find-references') {
          handleFindReferencesSelect()
        } else if (resolved?.type === 'file') {
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

    if (e.key === 'Backspace' && !input && selectedFiles.length === 0 && attachments.length > 0) {
      setAttachments(prev => prev.slice(0, -1))
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
    setAttachments([])
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
    attachments,
    setAttachments,
    isDragOver,
    refFinderOpen,
    setRefFinderOpen,
    handleInputChange,
    handleMentionSelect,
    handleDocMentionSelect,
    handlePlusClick,
    handleFindReferencesSelect,
    handleRefFinderApprove,
    handleKeyDown,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handlePaste,
    resetInput,
  }
}
