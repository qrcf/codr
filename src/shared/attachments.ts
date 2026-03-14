/** Attachment metadata — shared across main, preload, and renderer. */
export interface AttachmentMeta {
  /** Unique identifier (crypto.randomUUID) */
  id: string
  /** Original filename, e.g. "screenshot.png" */
  originalName: string
  /** Absolute path under userData/attachments/<id>/<filename> */
  storedPath: string
  /** MIME type, e.g. "image/png" */
  mimeType: string
  /** Determines how the file is sent to the API */
  category: 'image' | 'pdf' | 'text' | 'binary'
  /** File size in bytes */
  sizeBytes: number
  /** Base64 data URL for image previews (~200px wide) */
  thumbnailDataUrl?: string
}
