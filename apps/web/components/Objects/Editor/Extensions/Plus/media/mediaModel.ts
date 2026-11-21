/*
 Pure helpers for the media and data blocks (EDITOR_PLUS_SPEC.md, section C):
 attr values and defaults, normalisers for the stored JSON attrs, media
 sources, file types, the stat count-up and the slash menu starters. No
 React and no editor here, so the node specs, the views and the tests share
 one implementation.
*/

export const GALLERY_LAYOUTS = ['grid', 'carousel', 'masonry'] as const
export type GalleryLayout = (typeof GALLERY_LAYOUTS)[number]
export const GALLERY_COLUMNS = [2, 3, 4] as const
export type GalleryColumns = (typeof GALLERY_COLUMNS)[number]
export const MAX_GALLERY_IMAGES = 40

export const COMPARE_ORIENTATIONS = ['horizontal', 'vertical'] as const
export type CompareOrientation = (typeof COMPARE_ORIENTATIONS)[number]

export const STAT_COLUMNS = [2, 3, 4] as const
export type StatColumns = (typeof STAT_COLUMNS)[number]
export const MIN_STATS = 1
export const MAX_STATS = 8

/** Colour tokens a stat can take (palette classes in the views). */
export const STAT_TONES = ['neutral', 'blue', 'teal', 'green', 'amber', 'rose'] as const
export type StatTone = (typeof STAT_TONES)[number]

export const QUOTE_VARIANTS = ['pull', 'testimonial', 'highlight'] as const
export type QuoteVariant = (typeof QUOTE_VARIANTS)[number]

export function oneOf<T extends string | number>(list: readonly T[], value: unknown, fallback: T): T {
  return (list as readonly unknown[]).includes(value) ? (value as T) : fallback
}

export const statToneOf = (v: unknown): StatTone | null => ((STAT_TONES as readonly unknown[]).includes(v) ? (v as StatTone) : null)

let counter = 0
/** Short unique id for a list entry (gallery image, stat). */
export function newId(prefix = 'm'): string {
  counter = (counter + 1) % 1e6
  const rand = Math.random().toString(36).slice(2, 7)
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`
}

const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : '')
const optStr = (v: unknown, max = 500): string | undefined => {
  const s = str(v, max).trim()
  return s ? s : undefined
}

/** A link a learner may open: http(s), protocol-relative or site-relative only. */
export function safeUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const url = v.trim()
  if (!url) return null
  if (/^(https?:)?\/\//i.test(url) || (url.startsWith('/') && !url.startsWith('//'))) return url.slice(0, 2048)
  return null
}

/** A stored blockObject as written by the upload endpoints (BlockRead), or null. */
export function blockObjectOf(v: unknown): any | null {
  if (!v || typeof v !== 'object') return null
  const o = v as any
  if (typeof o.block_uuid !== 'string' || !o.content || typeof o.content !== 'object') return null
  return o
}

/** The upload directory a blockObject's file lives in (services/media/media.ts). */
export function blockDirectory(blockObject: any): 'imageBlock' | 'videoBlock' | 'audioBlock' | 'pdfBlock' {
  switch (blockObject?.block_type) {
    case 'BLOCK_VIDEO':
      return 'videoBlock'
    case 'BLOCK_AUDIO':
      return 'audioBlock'
    case 'BLOCK_DOCUMENT_PDF':
      return 'pdfBlock'
    default:
      return 'imageBlock'
  }
}

export const blockFileName = (blockObject: any): string =>
  blockObject?.content?.file_id ? `${blockObject.content.file_id}${blockObject.content.file_format ? `.${blockObject.content.file_format}` : ''}` : ''

export const hasSource = (src: { blockObject?: any; url?: string | null } | null | undefined) => !!(src && (blockObjectOf(src.blockObject) || safeUrl(src.url)))

// ── Gallery ───────────────────────────────────────────────────────────────

export interface GalleryImage {
  id: string
  blockObject?: any
  url?: string
  caption?: string
  alt?: string
}

/** Stored images as clean entries: an id each, a source each (blockObject or link), at most MAX_GALLERY_IMAGES. */
export function normalizeGalleryImages(raw: unknown): GalleryImage[] {
  const seen = new Set<string>()
  const out: GalleryImage[] = []
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!item || typeof item !== 'object') continue
    const blockObject = blockObjectOf((item as any).blockObject)
    const url = safeUrl((item as any).url)
    if (!blockObject && !url) continue
    let id = optStr((item as any).id, 80) ?? newId('img')
    if (seen.has(id)) id = newId('img')
    seen.add(id)
    const img: GalleryImage = { id }
    if (blockObject) img.blockObject = blockObject
    if (url) img.url = url
    const caption = optStr((item as any).caption, 300)
    const alt = optStr((item as any).alt, 500)
    if (caption) img.caption = caption
    if (alt) img.alt = alt
    out.push(img)
    if (out.length >= MAX_GALLERY_IMAGES) break
  }
  return out
}

export const missingAltCount = (images: GalleryImage[]) => images.filter((i) => !i.alt?.trim()).length

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return list
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

/** The carousel index after a step, wrapping around. */
export const wrapIndex = (index: number, count: number) => (count <= 0 ? 0 : ((index % count) + count) % count)

// ── Image compare ─────────────────────────────────────────────────────────

export interface CompareSide {
  blockObject?: any
  url?: string
  label: string
  alt?: string
}

export function normalizeCompareSide(raw: unknown, fallbackLabel = ''): CompareSide {
  const o = raw && typeof raw === 'object' ? (raw as any) : {}
  const side: CompareSide = { label: str(o.label, 80).trim() || fallbackLabel }
  const blockObject = blockObjectOf(o.blockObject)
  const url = safeUrl(o.url)
  if (blockObject) side.blockObject = blockObject
  if (url) side.url = url
  const alt = optStr(o.alt, 500)
  if (alt) side.alt = alt
  return side
}

/** Divider position as a whole percentage between 0 and 100 (50 when unset). */
export function clampPercent(v: unknown, fallback = 50): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.round(Math.min(100, Math.max(0, n)))
}

/** Next divider position for a key press (arrows step 1, Page keys 10, Home/End to the ends), or null for other keys. */
export function compareKeyStep(key: string, value: number, orientation: CompareOrientation): number | null {
  const horizontal = orientation === 'horizontal'
  const dec = horizontal ? ['ArrowLeft'] : ['ArrowUp']
  const inc = horizontal ? ['ArrowRight'] : ['ArrowDown']
  // The cross-axis arrows also work, as for any slider.
  if (dec.includes(key) || (horizontal ? key === 'ArrowDown' : key === 'ArrowLeft')) return clampPercent(value - 1)
  if (inc.includes(key) || (horizontal ? key === 'ArrowUp' : key === 'ArrowRight')) return clampPercent(value + 1)
  if (key === 'PageDown') return clampPercent(value - 10)
  if (key === 'PageUp') return clampPercent(value + 10)
  if (key === 'Home') return 0
  if (key === 'End') return 100
  return null
}

/** Divider position for a pointer at (x, y) inside a box. */
export function pointerPercent(rect: { left: number; top: number; width: number; height: number }, x: number, y: number, orientation: CompareOrientation): number {
  const pos = orientation === 'horizontal' ? (x - rect.left) / (rect.width || 1) : (y - rect.top) / (rect.height || 1)
  return clampPercent(pos * 100)
}

// ── Stat highlights ───────────────────────────────────────────────────────

export interface StatItem {
  id: string
  value: string
  label: string
  description?: string
  tone?: StatTone
  prefix?: string
  suffix?: string
}

export function normalizeStats(raw: unknown): StatItem[] {
  const seen = new Set<string>()
  const out: StatItem[] = []
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!item || typeof item !== 'object') continue
    let id = optStr((item as any).id, 80) ?? newId('stat')
    if (seen.has(id)) id = newId('stat')
    seen.add(id)
    const stat: StatItem = { id, value: str((item as any).value, 24).trim(), label: str((item as any).label, 120).trim() }
    const description = optStr((item as any).description, 300)
    const tone = statToneOf((item as any).tone)
    const prefix = optStr((item as any).prefix, 8)
    const suffix = optStr((item as any).suffix, 12)
    if (description) stat.description = description
    if (tone) stat.tone = tone
    if (prefix) stat.prefix = prefix
    if (suffix) stat.suffix = suffix
    out.push(stat)
    if (out.length >= MAX_STATS) break
  }
  return out
}

export interface ParsedStat {
  /** Text before the number ("~", "$"). */
  head: string
  number: number | null
  decimals: number
  /** Whether the stored text groups thousands ("12,500"). */
  grouped: boolean
  /** Text after the number ("k", "+"). */
  tail: string
}

/** Split a stat value ("12,500", "4.8", "~30k", "99.9%") into the number to count and the text around it. */
export function parseStatValue(value: string): ParsedStat {
  const s = String(value ?? '')
  const m = s.match(/^(.*?)(-?\d[\d,\u00a0\u202f ]*(?:\.\d+)?)(.*)$/)
  if (!m) return { head: s, number: null, decimals: 0, grouped: false, tail: '' }
  const digits = m[2]
  const grouped = /[,\u00a0\u202f ]/.test(digits.replace(/\.\d+$/, ''))
  const n = Number(digits.replace(/[,\u00a0\u202f ]/g, ''))
  const decimals = digits.includes('.') ? digits.split('.')[1].length : 0
  return { head: m[1], number: Number.isFinite(n) ? n : null, decimals, grouped, tail: m[3] }
}

/** easeOutCubic. */
export const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3)

/** The stat text at animation progress t (0..1): the counted number in the stored format; t = 1 gives the stored text. */
export function statFrame(value: string, t: number, locale?: string): string {
  if (t >= 1) return value
  const p = parseStatValue(value)
  if (p.number === null) return value
  const current = p.number * easeOut(t)
  let num: string
  try {
    num = new Intl.NumberFormat(locale ?? 'en-US', { minimumFractionDigits: p.decimals, maximumFractionDigits: p.decimals, useGrouping: p.grouped }).format(current)
  } catch {
    num = current.toFixed(p.decimals)
  }
  return `${p.head}${num}${p.tail}`
}

export const STAT_COUNT_MS = 1200

// ── File card ─────────────────────────────────────────────────────────────

export const FILE_TYPES = ['pdf', 'doc', 'sheet', 'slides', 'archive', 'image', 'audio', 'video', 'text', 'code', 'file'] as const
export type FileType = (typeof FILE_TYPES)[number]

const EXT_TYPES: Record<string, FileType> = {
  pdf: 'pdf',
  doc: 'doc', docx: 'doc', odt: 'doc', rtf: 'doc', pages: 'doc',
  xls: 'sheet', xlsx: 'sheet', ods: 'sheet', csv: 'sheet', numbers: 'sheet', tsv: 'sheet',
  ppt: 'slides', pptx: 'slides', odp: 'slides', key: 'slides',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive', tgz: 'archive',
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', svg: 'image', avif: 'image',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', flac: 'audio',
  mp4: 'video', webm: 'video', mov: 'video', mkv: 'video',
  txt: 'text', md: 'text',
  json: 'code', js: 'code', ts: 'code', py: 'code', html: 'code', css: 'code', xml: 'code', ipynb: 'code', sql: 'code',
}

export function fileExtensionOf(name: string): string {
  const clean = String(name ?? '').split(/[?#]/)[0]
  const base = clean.split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

export const fileTypeOf = (nameOrExt: string): FileType => EXT_TYPES[fileExtensionOf(nameOrExt) || String(nameOrExt ?? '').toLowerCase()] ?? 'file'
export const fileTypeValue = (v: unknown): FileType | null => ((FILE_TYPES as readonly unknown[]).includes(v) ? (v as FileType) : null)

/** The file's name from a link: the last path segment, decoded. */
export function fileNameFromUrl(url: string): string {
  try {
    const u = new URL(url, 'https://x.invalid')
    const last = u.pathname.split('/').filter(Boolean).pop() ?? ''
    return decodeURIComponent(last).slice(0, 200)
  } catch {
    return ''
  }
}

/** "2.4 MB", "820 KB" (null for unknown sizes). */
export function formatFileSize(bytes: unknown, locale?: string): string | null {
  const n = typeof bytes === 'number' ? bytes : Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return null
  const units = ['B', 'KB', 'MB', 'GB']
  let value = n
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const digits = value >= 10 || unit === 0 ? 0 : 1
  try {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${units[unit]}`
  } catch {
    return `${value.toFixed(digits)} ${units[unit]}`
  }
}

// ── Starters ──────────────────────────────────────────────────────────────

type T = (_key: string, _fallback: string) => string

export function sampleStats(t: T): StatItem[] {
  return [
    { id: newId('stat'), value: '92', suffix: '%', label: t('editor.blocks_v2.stat_highlights.sample.label_1', 'Completion rate'), description: t('editor.blocks_v2.stat_highlights.sample.desc_1', 'of learners finish the course'), tone: 'teal' },
    { id: newId('stat'), value: '4.8', suffix: '/5', label: t('editor.blocks_v2.stat_highlights.sample.label_2', 'Average rating'), description: t('editor.blocks_v2.stat_highlights.sample.desc_2', 'from 1,200 reviews'), tone: 'amber' },
    { id: newId('stat'), value: '12,500', suffix: '+', label: t('editor.blocks_v2.stat_highlights.sample.label_3', 'Learners'), description: t('editor.blocks_v2.stat_highlights.sample.desc_3', 'in 40 countries'), tone: 'blue' },
  ]
}

export function sampleQuote(t: T) {
  return {
    type: 'quoteBlock',
    attrs: {
      variant: 'testimonial',
      author: t('editor.blocks_v2.quote_block.sample.author', 'Sam Rivera'),
      role: t('editor.blocks_v2.quote_block.sample.role', 'Product designer'),
      avatarUrl: null,
    },
    content: [{ type: 'paragraph', content: [{ type: 'text', text: t('editor.blocks_v2.quote_block.sample.text', 'The hands-on exercises made it click. I used what I learned at work the very next day.') }] }],
  }
}
