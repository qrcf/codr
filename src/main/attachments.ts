import { randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir, stat, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { app, nativeImage } from 'electron'
import type { AttachmentMeta } from '../shared/attachments'

// ── MIME detection ──────────────────────────────────────────────────────────

const MIME_MAP: Record<string, string> = {
  // Images
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.bmp': 'image/bmp', '.heic': 'image/heic',
  // PDF
  '.pdf': 'application/pdf',
  // Text / code
  '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv',
  '.json': 'application/json', '.xml': 'text/xml', '.yaml': 'text/yaml',
  '.yml': 'text/yaml', '.toml': 'text/plain',
  '.ts': 'text/typescript', '.tsx': 'text/typescript',
  '.js': 'text/javascript', '.jsx': 'text/javascript', '.mjs': 'text/javascript',
  '.py': 'text/x-python', '.rs': 'text/x-rust', '.go': 'text/x-go',
  '.java': 'text/x-java', '.kt': 'text/x-kotlin', '.swift': 'text/x-swift',
  '.c': 'text/x-c', '.cpp': 'text/x-c++', '.h': 'text/x-c',
  '.cs': 'text/x-csharp', '.rb': 'text/x-ruby', '.php': 'text/x-php',
  '.sh': 'text/x-shellscript', '.bash': 'text/x-shellscript',
  '.html': 'text/html', '.css': 'text/css', '.scss': 'text/css',
  '.sql': 'text/x-sql', '.graphql': 'text/x-graphql',
  '.r': 'text/x-r', '.lua': 'text/x-lua', '.zig': 'text/x-zig',
  '.env': 'text/plain', '.gitignore': 'text/plain',
  '.dockerfile': 'text/plain', '.log': 'text/plain',
  '.ini': 'text/plain', '.cfg': 'text/plain', '.conf': 'text/plain',
}

// Extensions we treat as text even if MIME isn't in the map
const TEXT_EXTENSIONS = new Set([
  ...Object.keys(MIME_MAP).filter(k => {
    const m = MIME_MAP[k]
    return m.startsWith('text/') || m === 'application/json'
  }),
  '.lock', '.editorconfig', '.prettierrc', '.eslintrc',
])

function detectMime(filename: string): string {
  const ext = path.extname(filename).toLowerCase()
  return MIME_MAP[ext] || 'application/octet-stream'
}

function categorize(mimeType: string, filename: string): AttachmentMeta['category'] {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType.startsWith('text/') || mimeType === 'application/json') return 'text'
  const ext = path.extname(filename).toLowerCase()
  if (TEXT_EXTENSIONS.has(ext)) return 'text'
  return 'binary'
}

// ── Size limits ─────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB
const MAX_TEXT_SIZE = 50 * 1024         // 50 KB for text content blocks
const MAX_IMAGE_API_SIZE = 5 * 1024 * 1024 // 5 MB for API base64 images

// ── Storage ─────────────────────────────────────────────────────────────────

function getAttachmentsDir(): string {
  return path.join(app.getPath('userData'), 'attachments')
}

async function generateThumbnail(filePath: string): Promise<string | undefined> {
  try {
    const img = nativeImage.createFromPath(filePath)
    if (img.isEmpty()) return undefined
    const resized = img.resize({ width: 200 })
    return resized.toDataURL()
  } catch {
    return undefined
  }
}

export async function storeAttachment(filePath: string): Promise<AttachmentMeta> {
  const fileStat = await stat(filePath)
  if (fileStat.size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${(fileStat.size / 1024 / 1024).toFixed(1)} MB (max ${MAX_FILE_SIZE / 1024 / 1024} MB)`)
  }

  const id = randomUUID()
  const originalName = path.basename(filePath)
  const mimeType = detectMime(originalName)
  const category = categorize(mimeType, originalName)

  const dir = path.join(getAttachmentsDir(), id)
  await mkdir(dir, { recursive: true })
  const storedPath = path.join(dir, originalName)
  await copyFile(filePath, storedPath)

  let thumbnailDataUrl: string | undefined
  if (category === 'image') {
    thumbnailDataUrl = await generateThumbnail(storedPath)
  }

  return {
    id,
    originalName,
    storedPath,
    mimeType,
    category,
    sizeBytes: fileStat.size,
    thumbnailDataUrl,
  }
}

export async function storeAttachmentFromBuffer(buffer: Buffer, filename: string): Promise<AttachmentMeta> {
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${(buffer.length / 1024 / 1024).toFixed(1)} MB (max ${MAX_FILE_SIZE / 1024 / 1024} MB)`)
  }

  const id = randomUUID()
  const mimeType = detectMime(filename)
  const category = categorize(mimeType, filename)

  const dir = path.join(getAttachmentsDir(), id)
  await mkdir(dir, { recursive: true })
  const storedPath = path.join(dir, filename)
  await writeFile(storedPath, buffer)

  let thumbnailDataUrl: string | undefined
  if (category === 'image') {
    thumbnailDataUrl = await generateThumbnail(storedPath)
  }

  return {
    id,
    originalName: filename,
    storedPath,
    mimeType,
    category,
    sizeBytes: buffer.length,
    thumbnailDataUrl,
  }
}

// ── Content block conversion (for Claude API) ───────────────────────────────

export async function readAttachmentAsContentBlock(att: AttachmentMeta): Promise<Record<string, unknown>> {
  const data = await readFile(att.storedPath)

  switch (att.category) {
    case 'image': {
      let imageData: Buffer = data
      // Resize large images before base64 encoding
      if (data.length > MAX_IMAGE_API_SIZE) {
        try {
          const img = nativeImage.createFromPath(att.storedPath)
          if (!img.isEmpty()) {
            // Scale down proportionally
            const size = img.getSize()
            const scale = Math.sqrt(MAX_IMAGE_API_SIZE / data.length)
            const resized = img.resize({
              width: Math.round(size.width * scale),
              height: Math.round(size.height * scale),
            })
            imageData = resized.toPNG()
          }
        } catch {
          // Fall back to original data
        }
      }
      // Map unsupported MIME types to supported ones
      let mediaType = att.mimeType
      if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mediaType)) {
        mediaType = 'image/png'
      }
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType,
          data: imageData.toString('base64'),
        },
      }
    }

    case 'pdf':
      return {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: data.toString('base64'),
        },
      }

    case 'text': {
      const text = data.toString('utf-8')
      const truncated = text.length > MAX_TEXT_SIZE
        ? text.slice(0, MAX_TEXT_SIZE) + '\n... (truncated)'
        : text
      return {
        type: 'text',
        text: `<file name="${att.originalName}">\n${truncated}\n</file>`,
      }
    }

    case 'binary':
    default: {
      const sizeStr = att.sizeBytes < 1024
        ? `${att.sizeBytes} bytes`
        : att.sizeBytes < 1024 * 1024
          ? `${(att.sizeBytes / 1024).toFixed(1)} KB`
          : `${(att.sizeBytes / (1024 * 1024)).toFixed(1)} MB`
      return {
        type: 'text',
        text: `[Attached file: ${att.originalName} (${att.mimeType}, ${sizeStr})]`,
      }
    }
  }
}

// ── Content block conversion (for OpenAI / Codex) ───────────────────────────

export async function readAttachmentForOpenAI(att: AttachmentMeta): Promise<Record<string, unknown>> {
  if (att.category === 'image') {
    const data = await readFile(att.storedPath)
    const mediaType = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(att.mimeType)
      ? att.mimeType
      : 'image/png'
    return {
      type: 'image_url',
      image_url: {
        url: `data:${mediaType};base64,${data.toString('base64')}`,
      },
    }
  }

  // Non-image: fall back to text description
  return readAttachmentAsContentBlock(att)
}
