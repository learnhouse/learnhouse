/*
 What each upload block accepts, checked before a byte leaves the browser.

 The limits mirror the API's FILE_TYPES table (apps/api/src/security/
 file_validation.py) so an author learns about a wrong type or an oversized
 file immediately instead of after a long upload. The server still validates
 everything (magic bytes included); this is only the early, friendly check.

 Pure module: no React, no DOM beyond the `File`-like shape, so it is unit
 tested directly.
*/

export type MediaKind = 'image' | 'video' | 'audio' | 'pdf'

const MB = 1024 * 1024
const GB = 1024 * MB

export interface MediaKindSpec {
  /** Lower-case extensions without the dot. */
  extensions: string[]
  mimeTypes: string[]
  maxBytes: number
  /** The Tiptap node this kind of file becomes. */
  nodeType: 'blockImage' | 'blockVideo' | 'blockAudio' | 'blockPDF'
  /** API route under /api/v1/ that stores the file and returns a BlockRead. */
  endpoint: string
}

export const MEDIA_KINDS: Record<MediaKind, MediaKindSpec> = {
  image: {
    extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    maxBytes: 15 * MB,
    nodeType: 'blockImage',
    endpoint: 'blocks/image',
  },
  video: {
    extensions: ['mp4', 'webm'],
    mimeTypes: ['video/mp4', 'video/webm'],
    maxBytes: 5 * GB,
    nodeType: 'blockVideo',
    endpoint: 'blocks/video',
  },
  audio: {
    extensions: ['mp3', 'wav', 'ogg', 'm4a'],
    // Browsers report the same file under several names; accept them all.
    mimeTypes: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/m4a'],
    maxBytes: 1 * GB,
    nodeType: 'blockAudio',
    endpoint: 'blocks/audio',
  },
  pdf: {
    extensions: ['pdf'],
    mimeTypes: ['application/pdf'],
    maxBytes: 500 * MB,
    nodeType: 'blockPDF',
    endpoint: 'blocks/pdf',
  },
}

export const MEDIA_KIND_ORDER: MediaKind[] = ['image', 'video', 'audio', 'pdf']

interface FileLike {
  name: string
  type: string
  size: number
}

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

/** Which block a dropped/pasted file belongs in, or null when none takes it. */
export function kindForFile(file: FileLike): MediaKind | null {
  const mime = (file.type || '').toLowerCase()
  const ext = fileExtension(file.name || '')
  for (const kind of MEDIA_KIND_ORDER) {
    const spec = MEDIA_KINDS[kind]
    if (mime && spec.mimeTypes.includes(mime)) return kind
  }
  // Some platforms hand over files with an empty or generic type
  // (application/octet-stream); fall back to the extension.
  for (const kind of MEDIA_KIND_ORDER) {
    if (ext && MEDIA_KINDS[kind].extensions.includes(ext)) return kind
  }
  return null
}

export type FileValidation =
  | { ok: true; kind: MediaKind }
  | { ok: false; code: 'empty' | 'type' | 'size'; kind: MediaKind | null; maxBytes?: number }

/**
 * Validate a file for a given block kind (or for any kind when `expected` is
 * omitted, as on a drop onto the page).
 */
export function validateFile(file: FileLike, expected?: MediaKind): FileValidation {
  const detected = kindForFile(file)
  if (!detected || (expected && detected !== expected)) {
    return { ok: false, code: 'type', kind: expected ?? detected }
  }
  if (!file.size) return { ok: false, code: 'empty', kind: detected }
  const maxBytes = MEDIA_KINDS[detected].maxBytes
  if (file.size > maxBytes) return { ok: false, code: 'size', kind: detected, maxBytes }
  return { ok: true, kind: detected }
}

/** Value for an `<input type=file accept=…>`. */
export function acceptFor(kind: MediaKind): string {
  const spec = MEDIA_KINDS[kind]
  return [...spec.mimeTypes, ...spec.extensions.map((e) => `.${e}`)].join(',')
}

/** "1.5 MB", "820 KB", "2 GB" */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const rounded = value >= 10 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded} ${units[unit]}`
}

/** "JPG, PNG, WebP or GIF · up to 15 MB" style hint parts. */
export function formatHint(kind: MediaKind): { formats: string; max: string } {
  const names: Record<string, string> = { jpg: 'JPG', jpeg: '', png: 'PNG', webp: 'WebP', gif: 'GIF', mp4: 'MP4', webm: 'WebM', mp3: 'MP3', wav: 'WAV', ogg: 'OGG', m4a: 'M4A', pdf: 'PDF' }
  const formats = MEDIA_KINDS[kind].extensions.map((e) => names[e] ?? e.toUpperCase()).filter(Boolean).join(', ')
  return { formats, max: formatBytes(MEDIA_KINDS[kind].maxBytes) }
}
