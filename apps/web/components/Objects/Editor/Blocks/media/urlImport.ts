/*
 "Import from URL" for upload blocks: download a public file in the browser
 and hand it to the normal upload path, so the lesson keeps its own copy
 instead of hot-linking someone else's server.

 Many sites don't allow cross-origin downloads (no CORS headers). That fails
 with a TypeError we report as 'blocked'; the caller then offers a fallback
 (images can still be shown from the link, video links become embeds).
*/
import { MEDIA_KINDS, MediaKind, fileExtension, kindForFile } from './mediaKinds'

export class UrlImportError extends Error {
  code: 'blocked' | 'type' | 'size' | 'http'
  constructor(code: UrlImportError['code'], message?: string) {
    super(message || code)
    this.code = code
  }
}

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', webm: 'video/webm',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  pdf: 'application/pdf',
}

/** File name for a downloaded URL, with an extension matching its type. */
export function fileNameFromUrl(url: string, mime: string): string {
  let base = 'file'
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '')
    if (last) base = last.slice(0, 120)
  } catch {
    /* keep default */
  }
  if (fileExtension(base)) return base
  const ext = Object.entries(EXT_MIME).find(([, m]) => m === mime)?.[0]
  return ext ? `${base}.${ext}` : base
}

/** True when the link itself points at a file of this kind (by extension). */
export function looksLikeFileUrl(url: string, kind: MediaKind): boolean {
  try {
    const ext = fileExtension(new URL(url).pathname)
    return MEDIA_KINDS[kind].extensions.includes(ext)
  } catch {
    return false
  }
}

export async function fetchRemoteFile(url: string, kind: MediaKind, signal?: AbortSignal): Promise<File> {
  let res: Response
  try {
    res = await fetch(url, { mode: 'cors', credentials: 'omit', signal })
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err
    throw new UrlImportError('blocked')
  }
  if (!res.ok) throw new UrlImportError('http', `HTTP ${res.status}`)

  const declared = Number(res.headers.get('content-length') || 0)
  if (declared && declared > MEDIA_KINDS[kind].maxBytes && kind !== 'image') {
    throw new UrlImportError('size')
  }
  const blob = await res.blob()
  const headerType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  const extType = EXT_MIME[fileExtension(new URL(url).pathname)] || ''
  const type = MEDIA_KINDS[kind].mimeTypes.includes(blob.type) ? blob.type : MEDIA_KINDS[kind].mimeTypes.includes(headerType) ? headerType : extType
  const file = new File([blob], fileNameFromUrl(url, type), { type })
  if (kindForFile(file) !== kind) throw new UrlImportError('type')
  return file
}
