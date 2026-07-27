/*
 Single source of truth for "what kind of thing is this Library media row".

 The format tables used to be copy-pasted into every card and preview component,
 which is how they drifted. `file_mime` is on the model and is more reliable than
 the extension, so it wins when present.
*/

export type MediaKind = 'image' | 'video' | 'audio' | 'pdf' | 'embed' | 'file'

export const IMAGE_FORMATS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif']
export const VIDEO_FORMATS = ['mp4', 'webm', 'mov']
export const AUDIO_FORMATS = ['mp3', 'wav', 'ogg', 'm4a']

/** Minimal shape shared by Media rows and the block's cached snapshot. */
export type MediaLike = {
  media_type?: string | null
  file_format?: string | null
  file_mime?: string | null
  url?: string | null
} | null | undefined

export function mediaKind(resource: MediaLike): MediaKind {
  if (resource?.media_type === 'EMBED') return 'embed'

  const mime = (resource?.file_mime || '').toLowerCase()
  if (mime) {
    if (mime === 'application/pdf') return 'pdf'
    if (mime.startsWith('image/')) return 'image'
    if (mime.startsWith('video/')) return 'video'
    if (mime.startsWith('audio/')) return 'audio'
  }

  const format = (resource?.file_format || '').toLowerCase().replace(/^\./, '')
  if (format === 'pdf') return 'pdf'
  if (IMAGE_FORMATS.includes(format)) return 'image'
  if (VIDEO_FORMATS.includes(format)) return 'video'
  if (AUDIO_FORMATS.includes(format)) return 'audio'

  return 'file'
}

/** True when the kind has a real in-app viewer (rather than the download card). */
export function isPreviewableKind(kind: MediaKind): boolean {
  return kind !== 'file'
}

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatFileSize(bytes?: number | null): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return ''
  if (bytes < 1) return '0 B'
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 ? Math.round(value) : value.toFixed(value < 10 ? 1 : 0)} ${SIZE_UNITS[unit]}`
}
