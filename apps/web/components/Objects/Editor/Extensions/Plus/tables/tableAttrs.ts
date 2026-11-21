/*
 Table attributes added by Editor Plus (EDITOR_PLUS_SPEC.md, section A), and
 the pure helpers that turn a typed cell's text into what it shows.

 Backward compatibility contract:
 - every attr is optional and its default renders nothing, so a table saved
   before this change produces byte-identical HTML;
 - a typed cell keeps its value in its own text ("75", "4/5", "yes"), so
   copy/paste, export, AI, translation and older clients keep the content;
 - the visual comes from data attributes and an inline background-size that
   renderHTML derives from the text, so the editor, DynamicCanva and the static
   renderer (StaticCanva, @learnhouse/react) all draw it from the schema.

 Pure module: no DOM, React or i18n. Imported by the nodes, views and tests.
*/

type AttrSpec = {
  default: unknown
  parseHTML?: (_el: HTMLElement) => unknown
  renderHTML?: (_attrs: Record<string, any>) => Record<string, any>
}

export const TABLE_VARIANTS = ['default', 'striped', 'bordered', 'minimal', 'cards'] as const
export const TABLE_TOTALS = ['none', 'sum', 'average'] as const
export const CELL_TYPES = ['text', 'progress', 'checkbox', 'rating', 'status', 'number', 'date'] as const
/** Same names as the text colour palette (Blocks/marks/textMarks.ts). */
export const CELL_COLORS = ['gray', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'purple', 'pink'] as const
export const CELL_ALIGNS = ['start', 'center', 'end'] as const
export const CELL_VALIGNS = ['top', 'middle', 'bottom'] as const
export const NUMBER_FORMATS = ['plain', 'percent', 'currency', 'compact'] as const

export type TableVariant = (typeof TABLE_VARIANTS)[number]
export type TableTotals = (typeof TABLE_TOTALS)[number]
export type CellType = (typeof CELL_TYPES)[number]
export type CellColor = (typeof CELL_COLORS)[number]
export type CellAlign = (typeof CELL_ALIGNS)[number]
export type CellVAlign = (typeof CELL_VALIGNS)[number]
export type NumberFormat = (typeof NUMBER_FORMATS)[number]

function oneOf<T extends string>(list: readonly T[], value: unknown): T | null {
  return typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : null
}

const enumAttr = <T extends string>(name: string, list: readonly T[], fallback: T | null): AttrSpec => ({
  default: fallback,
  parseHTML: (el) => oneOf(list, el.getAttribute(`data-${name}`)) ?? fallback,
  renderHTML: (attrs) => {
    const v = oneOf(list, attrs[name.replace(/-(\w)/g, (_m, c) => c.toUpperCase())])
    return v && v !== fallback ? { [`data-${name}`]: v } : {}
  },
})

const flagAttr = (name: string, key: string): AttrSpec => ({
  default: false,
  parseHTML: (el) => el.hasAttribute(`data-${name}`) && el.getAttribute(`data-${name}`) !== 'false',
  renderHTML: (attrs) => (attrs[key] === true ? { [`data-${name}`]: '' } : {}),
})

// ─── Table ─────────────────────────────────────────────────────────────────

export const TABLE_EXTRA_ATTRS: Record<string, AttrSpec> = {
  variant: enumAttr('variant', TABLE_VARIANTS, 'default'),
  // Rendered as a <caption> by the node itself (see tableNodes.ts).
  caption: {
    default: null,
    parseHTML: (el) => {
      const caption = el.querySelector(':scope > caption')?.textContent?.trim()
      return caption || el.getAttribute('data-caption') || null
    },
    renderHTML: () => ({}),
  },
  headerColumn: flagAttr('header-column', 'headerColumn'),
  stickyHeader: flagAttr('sticky-header', 'stickyHeader'),
  sortable: flagAttr('sortable', 'sortable'),
  compact: flagAttr('compact', 'compact'),
  totals: enumAttr('totals', TABLE_TOTALS, 'none'),
}

export const TABLE_ATTR_DEFAULTS = {
  variant: 'default',
  caption: null,
  headerColumn: false,
  stickyHeader: false,
  sortable: false,
  compact: false,
  totals: 'none',
} as const

/** The data attributes a table element carries for its attrs (none by default). */
export function tableDataAttrs(attrs: Record<string, any>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, spec] of Object.entries(TABLE_EXTRA_ATTRS)) Object.assign(out, spec.renderHTML?.({ [name]: attrs?.[name] }))
  return out
}

// ─── Cells ─────────────────────────────────────────────────────────────────

/**
 * Replaces the stock `align` attribute: it still reads and writes the stock
 * left/center/right values, and also takes the logical start/end the
 * controls write (rendered as `text-align: start|end`, which flips in RTL).
 */
const ALIGN_VALUES = ['left', 'center', 'right', 'start', 'end'] as const

export const CELL_EXTRA_ATTRS: Record<string, AttrSpec> = {
  cellType: enumAttr('cell-type', CELL_TYPES, 'text'),
  background: enumAttr('background', CELL_COLORS, null),
  align: {
    default: null,
    parseHTML: (el) => oneOf(ALIGN_VALUES, (el.style?.textAlign || el.getAttribute('align') || '').trim().toLowerCase()),
    renderHTML: (attrs) => {
      const v = oneOf(ALIGN_VALUES, attrs.align)
      return v ? { style: `text-align: ${v}` } : {}
    },
  },
  valign: {
    default: null,
    parseHTML: (el) => oneOf(CELL_VALIGNS, el.getAttribute('data-valign')),
    renderHTML: (attrs) => {
      const v = oneOf(CELL_VALIGNS, attrs.valign)
      return v ? { 'data-valign': v, style: `vertical-align: ${v}` } : {}
    },
  },
  tone: enumAttr('tone', CELL_COLORS, null),
  numberFormat: enumAttr('number-format', NUMBER_FORMATS, null),
  currency: {
    default: null,
    parseHTML: (el) => normalizeCurrency(el.getAttribute('data-currency')),
    renderHTML: (attrs) => {
      const v = normalizeCurrency(attrs.currency)
      return v ? { 'data-currency': v } : {}
    },
  },
}

/** New cell attrs and the defaults that mean "render as before". */
export const CELL_ATTR_DEFAULTS = {
  cellType: 'text',
  background: null,
  valign: null,
  tone: null,
  numberFormat: null,
  currency: null,
} as const

export function normalizeCurrency(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(v) ? v : null
}

export function cellTypeOf(attrs: any): CellType {
  return oneOf(CELL_TYPES, attrs?.cellType) ?? 'text'
}

// ─── Typed values ──────────────────────────────────────────────────────────

/**
 * "1,234.5", "1.234,5", "$ 12", "-3", "12 %" → number. Null when the text
 * isn't a number. The decimal separator is whichever of , and . comes last
 * (a lone comma followed by exactly three digits is a thousands separator).
 */
export function parseNumber(text: string): number | null {
  let s = String(text ?? '').trim().replace(/[\s\u00a0\u202f']/g, '')
  if (!s) return null
  s = s.replace(/^[^\d+\-.,]+/, '').replace(/[^\d.,]+$/, '')
  const neg = s.startsWith('-')
  s = s.replace(/^[+-]/, '')
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma > -1 && lastDot > -1) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (lastComma > -1) {
    const parts = s.split(',')
    s = parts.length > 2 || /^\d{3}$/.test(parts[1]) ? parts.join('') : parts.join('.')
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, '')
  }
  const n = Number(s)
  return Number.isFinite(n) ? (neg ? -n : n) : null
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** "75", "75%", "0.75", "3/4" → 0..100. */
export function parseProgress(text: string): number | null {
  const s = String(text ?? '').trim()
  const frac = s.match(/^(-?\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)$/)
  if (frac) {
    const a = parseNumber(frac[1])
    const b = parseNumber(frac[2])
    return a != null && b ? clamp(Math.round((a / b) * 1000) / 10, 0, 100) : null
  }
  const n = parseNumber(s)
  if (n == null) return null
  // A bare fraction ("0.75") reads as a share; "1" stays 1%.
  const v = !s.includes('%') && n > 0 && n < 1 ? n * 100 : n
  return clamp(Math.round(v * 10) / 10, 0, 100)
}

const TRUE_WORDS = new Set(['yes', 'y', 'true', '1', '✓', '✔', '☑', '✅', 'x', 'done', 'on', 'oui', 'sí', 'si', 'ja', 'sim', 'да', 'نعم', 'はい', '是', '예'])
const FALSE_WORDS = new Set(['no', 'n', 'false', '0', '✗', '✘', '☐', '❌', '-', '', 'off', 'non', 'nein', 'nee', 'não', 'nao', 'нет', 'لا', 'いいえ', '否', '아니오'])

/** true / false, or null when the text is neither. Empty counts as unchecked. */
export function parseCheckbox(text: string): boolean | null {
  const s = String(text ?? '').trim().toLowerCase()
  if (TRUE_WORDS.has(s)) return true
  if (FALSE_WORDS.has(s)) return false
  return null
}

/** The text a checkbox cell gets when toggled, keeping the author's vocabulary. */
export function toggledCheckboxText(text: string): string {
  const s = String(text ?? '').trim()
  const pairs: [string, string][] = [['yes', 'no'], ['true', 'false'], ['1', '0'], ['✓', '✗'], ['✔', '✘'], ['y', 'n'], ['on', 'off']]
  for (const [on, off] of pairs) {
    const match = (w: string) => s.toLowerCase() === w
    const cased = (w: string) => (s && s[0] === s[0].toUpperCase() && /[a-z]/i.test(s) ? w[0].toUpperCase() + w.slice(1) : w)
    if (match(on)) return cased(off)
    if (match(off)) return cased(on)
  }
  return parseCheckbox(s) ? '✗' : '✓'
}

/** "4", "4/5", "3.5 / 10", "★★★" → { value, max }. */
export function parseRating(text: string): { value: number; max: number } | null {
  const s = String(text ?? '').trim()
  if (!s) return null
  const stars = s.match(/^[★⭐]+[☆]*$/u)
  if (stars) {
    const full = [...s].filter((c) => c === '★' || c === '⭐').length
    return { value: full, max: Math.max(5, [...s].length) }
  }
  const frac = s.match(/^(\d+(?:[.,]\d+)?)\s*\/\s*(\d+)$/)
  if (frac) {
    const max = clamp(parseInt(frac[2], 10), 1, 10)
    const value = parseNumber(frac[1])
    return value == null ? null : { value: clamp(value, 0, max), max }
  }
  const n = parseNumber(s)
  return n == null ? null : { value: clamp(n, 0, 5), max: 5 }
}

/** ISO dates (YYYY-MM-DD) are read as calendar dates, never shifted by time zone. */
export function parseDate(text: string): Date | null {
  const s = String(text ?? '').trim()
  if (!s) return null
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) {
    const d = new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]))
    return d.getUTCMonth() === +iso[2] - 1 ? d : null
  }
  if (!/\d/.test(s)) return null
  const t = Date.parse(s)
  if (Number.isNaN(t)) return null
  const d = new Date(t)
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
}

/** Status words → a tone, used when the author hasn't picked one. */
export function autoStatusTone(text: string): CellColor {
  const s = String(text ?? '').trim().toLowerCase()
  if (!s) return 'gray'
  if (/(done|complete|finished|passed|approved|shipped|live|ok\b|yes|ready|terminé|fait|erledigt|fertig|hecho|listo|concluído|feito)/.test(s)) return 'green'
  if (/(progress|doing|started|review|ongoing|wip|en cours|in arbeit|en curso|em andamento)/.test(s)) return 'blue'
  if (/(blocked|late|overdue|fail|rejected|stuck|bloqué|blockiert|bloqueado|retard)/.test(s)) return 'red'
  if (/(risk|wait|hold|pending|paused|attente|warte|pendiente)/.test(s)) return 'amber'
  return 'gray'
}

export function progressTone(value: number): CellColor {
  return value >= 100 ? 'green' : value >= 50 ? 'blue' : value > 0 ? 'amber' : 'gray'
}

/** The locale typed values are formatted in (the page's language). */
export function tableLocale(): string {
  try {
    const lang = (globalThis as any).document?.documentElement?.lang
    if (lang) return lang
  } catch {
    /* no DOM */
  }
  return 'en'
}

export function formatNumber(value: number, format: NumberFormat | null, currency: string | null, locale = tableLocale()): string {
  try {
    switch (format) {
      case 'percent':
        return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(value / 100)
      case 'currency':
        return new Intl.NumberFormat(locale, { style: 'currency', currency: currency || 'USD' }).format(value)
      case 'compact':
        return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
      default:
        return new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(value)
    }
  } catch {
    return String(value)
  }
}

export function formatDate(date: Date, locale = tableLocale()): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(date)
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

export interface TypedCellView {
  /** Shown in place of the text for learners (and as a hint in the editor). */
  display: string | null
  /** 0..100 for progress, used as the bar's width. */
  percent: number | null
  /** on/off for checkboxes. */
  state: 'on' | 'off' | null
  tone: CellColor | null
  /** A sortable, comparable key (null when empty or unreadable). */
  sortKey: number | string | null
}

/** What a typed cell shows, from its type, attrs and text. */
export function typedCellView(type: CellType, attrs: any, text: string, locale?: string): TypedCellView {
  const raw = String(text ?? '').trim()
  const none: TypedCellView = { display: null, percent: null, state: null, tone: null, sortKey: null }
  const tone = oneOf(CELL_COLORS, attrs?.tone)
  switch (type) {
    case 'progress': {
      const p = parseProgress(raw)
      if (p == null) return none
      return { display: `${formatNumber(p, null, null, locale)}%`, percent: p, state: null, tone: tone ?? progressTone(p), sortKey: p }
    }
    case 'checkbox': {
      const on = parseCheckbox(raw)
      if (on == null) return { ...none, sortKey: raw.toLowerCase() || null }
      return { display: on ? '✓' : '✗', percent: null, state: on ? 'on' : 'off', tone: tone ?? (on ? 'green' : 'gray'), sortKey: on ? 1 : 0 }
    }
    case 'rating': {
      const r = parseRating(raw)
      if (!r) return none
      const full = Math.round(r.value)
      return { display: '★'.repeat(full) + '☆'.repeat(Math.max(0, r.max - full)), percent: null, state: null, tone: tone ?? 'amber', sortKey: r.value / r.max }
    }
    case 'status':
      return raw ? { display: null, percent: null, state: null, tone: tone ?? autoStatusTone(raw), sortKey: raw.toLowerCase() } : none
    case 'number': {
      const n = parseNumber(raw)
      if (n == null) return { ...none, sortKey: raw.toLowerCase() || null }
      return { display: formatNumber(n, oneOf(NUMBER_FORMATS, attrs?.numberFormat), normalizeCurrency(attrs?.currency), locale), percent: null, state: null, tone, sortKey: n }
    }
    case 'date': {
      const d = parseDate(raw)
      if (!d) return { ...none, sortKey: raw.toLowerCase() || null }
      return { display: formatDate(d, locale), percent: null, state: null, tone, sortKey: d.getTime() }
    }
    default:
      return { ...none, sortKey: raw.toLowerCase() || null }
  }
}

/**
 * The extra HTML attributes a typed cell renders from its text. A text cell
 * (the default) gets none, so its HTML is exactly what it was.
 */
export function typedCellAttrs(attrs: any, text: string, locale?: string): Record<string, string> {
  const type = cellTypeOf(attrs)
  if (type === 'text') return {}
  const raw = String(text ?? '').trim()
  const view = typedCellView(type, attrs, raw, locale)
  const out: Record<string, string> = {}
  if (raw) out['aria-label'] = raw
  if (view.display != null) out['data-lh-display'] = view.display
  if (view.state) out['data-lh-state'] = view.state
  if (view.tone && !attrs?.tone) out['data-lh-tone'] = view.tone
  // The bar is a background layer sized from the value, so the static
  // renderer (which can't carry CSS variables in a style string) draws it too.
  if (view.percent != null) out.style = `background-size: ${view.percent}% 6px, 100% 6px`
  return out
}

/** Text helpers shared by the model and the views. */
export const typedSortKey = (attrs: any, text: string) => typedCellView(cellTypeOf(attrs), attrs, text, 'en').sortKey
