import type { TFunction } from 'i18next'
import { MediaKind, formatBytes, formatHint } from './mediaKinds'

export function kindLabel(t: TFunction, kind: MediaKind | null | undefined): string {
  switch (kind) {
    case 'image': return t('editor.blocks_v2.kind.image', 'image')
    case 'video': return t('editor.blocks_v2.kind.video', 'video')
    case 'audio': return t('editor.blocks_v2.kind.audio', 'audio file')
    case 'pdf': return t('editor.blocks_v2.kind.pdf', 'PDF')
    default: return t('editor.blocks_v2.kind.file', 'file')
  }
}

/** One readable sentence for any upload failure. */
export function uploadErrorText(
  t: TFunction,
  opts: { code?: string; kind?: MediaKind | null; fileSize?: number; maxBytes?: number; error?: string },
): string {
  const kind = opts.kind ?? null
  switch (opts.code) {
    case 'type':
      return kind
        ? t('editor.blocks_v2.errors.type', 'That file type isn’t supported here. Use {{formats}}.', { formats: formatHint(kind).formats })
        : t('editor.blocks_v2.errors.type_any', 'That file type can’t be added to a lesson.')
    case 'size':
      return t('editor.blocks_v2.errors.size', 'This file is {{size}}. The limit for a {{kind}} is {{max}}.', {
        size: formatBytes(opts.fileSize || 0),
        kind: kindLabel(t, kind),
        max: kind ? formatHint(kind).max : formatBytes(opts.maxBytes || 0),
      })
    case 'empty':
      return t('editor.blocks_v2.errors.empty', 'This file is empty.')
    case 'cancelled':
      return t('editor.blocks_v2.errors.cancelled', 'Upload cancelled.')
    case 'blocked':
      return t('editor.blocks_v2.errors.blocked', 'That site doesn’t allow downloads from other sites. Download the file and upload it instead.')
    case 'http':
      return t('editor.blocks_v2.errors.http', 'Couldn’t download that link ({{error}}).', { error: opts.error || '' })
    case 'url':
      return t('editor.blocks_v2.errors.url', 'That doesn’t look like a web link.')
    default:
      return opts.error || t('editor.blocks_v2.errors.server', 'Upload failed. Try again.')
  }
}
