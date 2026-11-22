/*
 The attributes this redesign adds to existing blocks, and the pure helpers
 that turn stored attrs into what a block shows.

 Backward compatibility contract (tested against real stored activities in
 tests/editor-blocks-compat.test.mjs):
 - every new attr is optional and its default reproduces the old rendering
   exactly (no caption, no link, lightbox on, old widths/alignments, …);
 - nothing here rewrites an attr the old code wrote; old JSON round-trips
   through the editor unchanged apart from the new defaults being filled in.

 Pure module: imported by the node definitions, the node views and the tests.
*/

type AttrSpec = {
  default: unknown
  parseHTML?: (_el: HTMLElement) => unknown
  renderHTML?: (_attrs: Record<string, any>) => Record<string, any>
  keepOnSplit?: boolean
}

/** JSON-valued attribute that survives copy/paste through HTML. */
function jsonAttr(name: string, fallback: unknown = null): AttrSpec {
  return {
    default: fallback,
    parseHTML: (el) => {
      const raw = el.getAttribute(`data-${name}`)
      if (!raw) return fallback
      try {
        return JSON.parse(raw)
      } catch {
        return fallback
      }
    },
    renderHTML: (attrs) => (attrs[name] == null ? {} : { [`data-${name}`]: JSON.stringify(attrs[name]) }),
  }
}

function textAttr(name: string, fallback: string | null = ''): AttrSpec {
  return {
    default: fallback,
    parseHTML: (el) => el.getAttribute(`data-${name}`) ?? fallback,
    renderHTML: (attrs) => (attrs[name] ? { [`data-${name}`]: String(attrs[name]) } : {}),
  }
}

/** Boolean attribute stored as data-<name>; nothing is written for the default. */
function boolAttr(key: string, name: string, fallback = false): AttrSpec {
  return {
    default: fallback,
    parseHTML: (el) => {
      const raw = el.getAttribute(`data-${name}`)
      return raw == null ? fallback : raw === 'true'
    },
    renderHTML: (attrs) => (!!attrs[key] === fallback ? {} : { [`data-${name}`]: String(!!attrs[key]) }),
  }
}

/** Text attribute limited to known values (unknown → null, the old look). */
function enumAttr(name: string, values: readonly string[]): AttrSpec {
  return {
    default: null,
    parseHTML: (el) => {
      const v = el.getAttribute(`data-${name}`)
      return v && values.includes(v) ? v : null
    },
    renderHTML: (attrs) => (attrs[name] && values.includes(attrs[name]) ? { [`data-${name}`]: String(attrs[name]) } : {}),
  }
}

const oneOf = <T extends string>(values: readonly T[], v: unknown, fallback: T): T =>
  typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : fallback

// ─── Image ─────────────────────────────────────────────────────────────────

export const IMAGE_EXTRA_ATTRS: Record<string, AttrSpec> = {
  alt: textAttr('alt'),
  caption: textAttr('caption'),
  href: textAttr('href', null),
  // Old images always offered the expand-to-viewer button.
  lightbox: {
    default: true,
    parseHTML: (el) => el.getAttribute('data-lightbox') !== 'false',
    renderHTML: (attrs) => (attrs.lightbox === false ? { 'data-lightbox': 'false' } : {}),
  },
  // Editor Plus: a frame around the picture. null = 'none', the old look.
  frame: enumAttr('frame', ['none', 'rounded', 'shadow', 'border', 'polaroid']),
}

export const IMAGE_FRAMES = ['none', 'rounded', 'shadow', 'border', 'polaroid'] as const
export type ImageFrame = (typeof IMAGE_FRAMES)[number]

export function imageFrameOf(attrs: any): ImageFrame {
  return oneOf(IMAGE_FRAMES, attrs?.frame, 'none')
}

/**
 * Classes for the frame: `box` wraps the picture, `img` replaces the image's
 * own rounding. 'none' is exactly the old image (rounded-lg, no wrapper styles).
 */
export function imageFrameClasses(frame: ImageFrame): { box: string; img: string } {
  switch (frame) {
    case 'rounded':
      return { box: '', img: 'rounded-3xl max-md:rounded-3xl' }
    case 'shadow':
      return { box: '', img: 'rounded-lg max-md:rounded-xl shadow-[0_10px_30px_-8px_rgba(0,0,0,0.35)]' }
    case 'border':
      return { box: 'rounded-xl bg-white p-1.5 ring-1 ring-black/10', img: 'rounded-lg' }
    case 'polaroid':
      return { box: 'lh-image-polaroid rounded-sm bg-white p-2.5 pb-9 shadow-[0_6px_20px_-6px_rgba(0,0,0,0.3)] ring-1 ring-black/5', img: 'rounded-none' }
    default:
      return { box: '', img: 'rounded-lg max-md:rounded-xl' }
  }
}

/** The image block rendered 300 px wide when no size was ever stored. */
export const LEGACY_IMAGE_WIDTH = 300

export const IMAGE_WIDTH_PRESETS = [
  { id: 'small', width: 320 },
  { id: 'medium', width: 560 },
  { id: 'large', width: 800 },
  { id: 'full', width: '100%' as const },
] as const

export type ImageAlignment = 'left' | 'center' | 'right'

export function imageWidthOf(attrs: any): number | '100%' {
  const w = attrs?.size?.width
  if (w === '100%') return '100%'
  const n = typeof w === 'string' ? parseFloat(w) : w
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : LEGACY_IMAGE_WIDTH
}

export function imageWidthPresetOf(attrs: any): string | null {
  const w = imageWidthOf(attrs)
  const hit = IMAGE_WIDTH_PRESETS.find((p) => p.width === w)
  return hit ? hit.id : null
}

export function imageAlignmentOf(attrs: any): ImageAlignment {
  const a = attrs?.alignment
  return a === 'left' || a === 'right' ? a : 'center'
}

/** Only links a learner can safely follow. */
export function safeHref(href: unknown): string | null {
  if (typeof href !== 'string') return null
  const v = href.trim()
  if (!v) return null
  try {
    const u = new URL(v)
    return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:' ? u.toString() : null
  } catch {
    return null
  }
}

export interface ImageView {
  width: number | '100%'
  alignment: ImageAlignment
  alt: string
  caption: string
  href: string | null
  lightbox: boolean
  frame: ImageFrame
}

export function resolveImageView(attrs: any): ImageView {
  return {
    width: imageWidthOf(attrs),
    alignment: imageAlignmentOf(attrs),
    alt: typeof attrs?.alt === 'string' ? attrs.alt : '',
    caption: typeof attrs?.caption === 'string' ? attrs.caption : '',
    href: safeHref(attrs?.href),
    lightbox: attrs?.lightbox !== false,
    frame: imageFrameOf(attrs),
  }
}

// ─── Video ─────────────────────────────────────────────────────────────────

export const VIDEO_EXTRA_ATTRS: Record<string, AttrSpec> = {
  caption: textAttr('caption'),
  startTime: {
    default: null,
    parseHTML: (el) => {
      const v = parseInt(el.getAttribute('data-start-time') || '', 10)
      return Number.isFinite(v) && v > 0 ? v : null
    },
    renderHTML: (attrs) => (attrs.startTime ? { 'data-start-time': String(attrs.startTime) } : {}),
  },
  chapters: jsonAttr('chapters'),
}

/** "1:05" → 65, "1:02:03" → 3723, "90" → 90. Null when unreadable. */
export function parseTimecode(input: unknown): number | null {
  if (typeof input === 'number') return Number.isFinite(input) && input >= 0 ? Math.floor(input) : null
  if (typeof input !== 'string') return null
  const v = input.trim()
  if (!v) return null
  if (!/^\d+(:\d{1,2}){0,2}$/.test(v)) return null
  const parts = v.split(':').map((p) => parseInt(p, 10))
  if (parts.slice(1).some((p) => p > 59)) return null
  return parts.reduce((acc, p) => acc * 60 + p, 0)
}

export function formatTimecode(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

export interface BlockChapter {
  start: number
  title: string
}

/** Clean, sorted, de-duplicated chapters (the player's VideoChapter shape). */
export function normalizeChapters(raw: unknown): BlockChapter[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<number>()
  const out: BlockChapter[] = []
  for (const item of raw) {
    const start = parseTimecode((item as any)?.start)
    const title = typeof (item as any)?.title === 'string' ? (item as any).title.trim().slice(0, 120) : ''
    if (start == null || !title || seen.has(start)) continue
    seen.add(start)
    out.push({ start, title })
  }
  return out.sort((a, b) => a.start - b.start).slice(0, 50)
}

// Video block sizes (stored inside blockObject.size).
export const VIDEO_SIZES = {
  small: { width: 480 },
  medium: { width: 720 },
  large: { width: 960 },
} as const

export type VideoSize = keyof typeof VIDEO_SIZES

// Blocks saved before sizes were names stored a pixel width (or '100%').
const getVideoSizeFromWidth = (width: number | string | undefined): VideoSize => {
  if (!width) return 'medium'
  if (width === '100%') return 'large'
  const numWidth = typeof width === 'string' ? parseInt(width) : width
  if (numWidth <= VIDEO_SIZES.small.width) return 'small'
  if (numWidth <= VIDEO_SIZES.medium.width) return 'medium'
  return 'large'
}

/** The stored blockObject with its size read as a name, without writing it back. */
export function resolveVideoBlockObject(raw: any): any | null {
  if (!raw) return null
  if (typeof raw.size === 'string') {
    if (raw.size === 'full') return { ...raw, size: 'large' }
    if (raw.size in VIDEO_SIZES) return raw
  }
  return { ...raw, size: getVideoSizeFromWidth(raw.size?.width) }
}

// ─── Audio / PDF / Embed ───────────────────────────────────────────────────

export const AUDIO_EXTRA_ATTRS: Record<string, AttrSpec> = {
  caption: textAttr('caption'),
  transcript: textAttr('transcript'),
}

export const PDF_EXTRA_ATTRS: Record<string, AttrSpec> = {
  caption: textAttr('caption'),
}

/** Preview heights offered as one-click presets (px); null = default. */
export const PDF_HEIGHT_PRESETS = [
  { id: 'short', height: 480 },
  { id: 'medium', height: 720 },
  { id: 'tall', height: 1000 },
] as const

/** Whole seconds stored as data-<name>; null (the default) writes nothing. */
function secondsAttr(dataName: string): AttrSpec {
  return {
    default: null,
    parseHTML: (el) => {
      const v = parseInt(el.getAttribute(`data-${dataName}`) || '', 10)
      return Number.isFinite(v) && v > 0 ? v : null
    },
    renderHTML: (attrs) => {
      const key = dataName === 'start-time' ? 'startTime' : 'endTime'
      return attrs[key] ? { [`data-${dataName}`]: String(attrs[key]) } : {}
    },
  }
}

export const EMBED_EXTRA_ATTRS: Record<string, AttrSpec> = {
  // The link as pasted (the iframe URL can differ, e.g. youtu.be → /embed/).
  embedSourceUrl: textAttr('source-url', null),
  // Set only by the new smart-paste flow; null keeps the legacy render path.
  embedProvider: textAttr('provider', null),
  caption: textAttr('caption'),
  // Video embeds: the part learners watch, in seconds. Also written into the
  // embed URL (see withTrim), so renderers that ignore these attrs still trim.
  startTime: secondsAttr('start-time'),
  endTime: secondsAttr('end-time'),
}

// ─── Callout / code / divider ──────────────────────────────────────────────

export const CALLOUT_EXTRA_ATTRS: Record<string, AttrSpec> = {
  // null = the type's own icon (old behaviour); otherwise a CALLOUT_ICONS key or an emoji.
  icon: {
    default: null,
    parseHTML: (el) => el.getAttribute('data-icon') || null,
    renderHTML: (attrs) => (attrs.icon ? { 'data-icon': attrs.icon } : {}),
  },
  // Editor Plus. An empty title, not collapsible and no tone is the old callout.
  title: textAttr('title'),
  collapsible: boolAttr('collapsible', 'collapsible'),
  // Only read when collapsible: whether learners first see it open.
  defaultOpen: boolAttr('defaultOpen', 'default-open', true),
  // null = the type's own colours; otherwise a CALLOUT_TONES key.
  tone: textAttr('tone', null),
  // note / question / example / quote. Kept out of `type`, which older
  // renderers look up in a fixed table (they crash on unknown values); `type`
  // then holds the closest legacy look (calloutStyles.CALLOUT_KIND_FALLBACK).
  kind: enumAttr('kind', ['note', 'question', 'example', 'quote']),
}

export const CODE_BLOCK_EXTRA_ATTRS: Record<string, AttrSpec> = {
  filename: {
    default: null,
    parseHTML: (el) => el.getAttribute('data-filename') || null,
    renderHTML: (attrs) => (attrs.filename ? { 'data-filename': attrs.filename } : {}),
  },
  // Editor Plus. Off / none / off is the old code block.
  showLineNumbers: boolAttr('showLineNumbers', 'line-numbers'),
  // Lines to emphasise, e.g. "2,4-6" (see codeBlockModel.parseHighlightLines).
  highlightLines: {
    default: null,
    parseHTML: (el) => el.getAttribute('data-highlight-lines') || null,
    renderHTML: (attrs) => (attrs.highlightLines ? { 'data-highlight-lines': String(attrs.highlightLines) } : {}),
  },
  // Wrap long lines everywhere (phones otherwise scroll sideways).
  wrap: boolAttr('wrap', 'wrap'),
}

// ─── Toggle / button / text alignment (Editor Plus) ────────────────────────

export const TOGGLE_VARIANTS = ['default', 'bordered', 'filled'] as const
export type ToggleVariant = (typeof TOGGLE_VARIANTS)[number]
export const TOGGLE_ICONS = ['chevron', 'plus'] as const
export type ToggleIcon = (typeof TOGGLE_ICONS)[number]

/** null/unknown → 'default' / 'chevron', the original toggle. */
export const TOGGLE_EXTRA_ATTRS: Record<string, AttrSpec> = {
  variant: enumAttr('variant', TOGGLE_VARIANTS),
  icon: enumAttr('icon', TOGGLE_ICONS),
}

export function toggleVariantOf(attrs: any): ToggleVariant {
  return oneOf(TOGGLE_VARIANTS, attrs?.variant, 'default')
}

export function toggleIconOf(attrs: any): ToggleIcon {
  return oneOf(TOGGLE_ICONS, attrs?.icon, 'chevron')
}

export const BUTTON_VARIANTS = ['solid', 'outline', 'soft', 'link'] as const
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number]
export const BUTTON_SIZES = ['sm', 'md', 'lg'] as const
export type ButtonSize = (typeof BUTTON_SIZES)[number]

/** null/unknown → 'solid' / 'md', the original button. */
export const BUTTON_EXTRA_ATTRS: Record<string, AttrSpec> = {
  variant: enumAttr('variant', BUTTON_VARIANTS),
  size: enumAttr('size', BUTTON_SIZES),
}

export function buttonVariantOf(attrs: any): ButtonVariant {
  return oneOf(BUTTON_VARIANTS, attrs?.variant, 'solid')
}

export function buttonSizeOf(attrs: any): ButtonSize {
  return oneOf(BUTTON_SIZES, attrs?.size, 'md')
}

export const TEXT_ALIGNMENTS = ['start', 'center', 'end', 'justify'] as const
export type TextAlignment = (typeof TEXT_ALIGNMENTS)[number]

/** Pasted HTML says left/right; stored values are writing-direction aware. */
export function readTextAlign(value: unknown): TextAlignment | null {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (v === 'left') return 'start'
  if (v === 'right') return 'end'
  return (TEXT_ALIGNMENTS as readonly string[]).includes(v) ? (v as TextAlignment) : null
}

/**
 * Global `textAlign` on paragraphs and headings. null (the default, and every
 * stored paragraph) writes no attribute and no style, so stored HTML and JSON
 * stay as they were.
 */
export const TEXT_ALIGN_ATTR: AttrSpec = {
  default: null,
  parseHTML: (el) => readTextAlign(el.style?.textAlign),
  renderHTML: (attrs) => {
    const v = readTextAlign(attrs.textAlign)
    return v ? { style: `text-align: ${v}` } : {}
  },
}

export const TEXT_ALIGN_TYPES = ['paragraph', 'heading'] as const

export const DIVIDER_VARIANTS = ['line', 'dashed', 'dotted', 'thick', 'dots', 'space'] as const
export type DividerVariant = (typeof DIVIDER_VARIANTS)[number]

/** Global attr added to horizontalRule (rendered as data-variant, styled in blocks.css). */
export const DIVIDER_EXTRA_ATTRS: Record<string, AttrSpec> = {
  variant: {
    default: null,
    parseHTML: (el) => el.getAttribute('data-variant') || null,
    renderHTML: (attrs) => (attrs.variant ? { 'data-variant': attrs.variant } : {}),
  },
}

/** null/unknown → 'line', which is the original hr look. */
export function dividerVariantOf(attrs: any): DividerVariant {
  const v = attrs?.variant
  return (DIVIDER_VARIANTS as readonly string[]).includes(v) ? v : 'line'
}

/** Every attr each block gained, by node type, with its default. */
export const NEW_ATTR_DEFAULTS: Record<string, Record<string, unknown>> = {
  blockImage: Object.fromEntries(Object.entries(IMAGE_EXTRA_ATTRS).map(([k, v]) => [k, v.default])),
  blockVideo: Object.fromEntries(Object.entries(VIDEO_EXTRA_ATTRS).map(([k, v]) => [k, v.default])),
  blockAudio: Object.fromEntries(Object.entries(AUDIO_EXTRA_ATTRS).map(([k, v]) => [k, v.default])),
  blockPDF: Object.fromEntries(Object.entries(PDF_EXTRA_ATTRS).map(([k, v]) => [k, v.default])),
  blockEmbed: Object.fromEntries(Object.entries(EMBED_EXTRA_ATTRS).map(([k, v]) => [k, v.default])),
  callout: Object.fromEntries(Object.entries(CALLOUT_EXTRA_ATTRS).map(([k, v]) => [k, v.default])),
  codeBlock: Object.fromEntries(Object.entries(CODE_BLOCK_EXTRA_ATTRS).map(([k, v]) => [k, v.default])),
  horizontalRule: Object.fromEntries(Object.entries(DIVIDER_EXTRA_ATTRS).map(([k, v]) => [k, v.default])),
  toggleBlock: Object.fromEntries(Object.entries(TOGGLE_EXTRA_ATTRS).map(([k, v]) => [k, v.default])),
  button: Object.fromEntries(Object.entries(BUTTON_EXTRA_ATTRS).map(([k, v]) => [k, v.default])),
  paragraph: { textAlign: TEXT_ALIGN_ATTR.default },
  heading: { textAlign: TEXT_ALIGN_ATTR.default },
}
