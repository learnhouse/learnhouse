/*
 Pure chart logic for the `chart` block (EDITOR_PLUS_SPEC.md, section C):
 data normalising, nice ticks, scales, stacking, path building, pie arcs,
 CSV parsing and the chart geometry. No React and no DOM, so the editor
 view, renderHTML (server SVG) and the tests share one implementation.

 Geometry is laid out in pixels for a given width and height; the SVG is
 drawn at that size, so text keeps its real size on a phone instead of being
 scaled down with a viewBox.
*/

export const CHART_TYPES = ['bar', 'column', 'line', 'area', 'pie', 'donut'] as const
export type ChartType = (typeof CHART_TYPES)[number]

/** Series colour tokens, mapped onto the design system chart palette (--color-lh-chart-1..8). */
export const CHART_TONES = ['blue', 'orange', 'teal', 'amber', 'pink', 'green', 'violet', 'red'] as const
export type ChartTone = (typeof CHART_TONES)[number]

/** Light-theme hex for each palette slot (design/tokens.ts chartSeries), the fallback when CSS variables are missing. */
export const CHART_HEX = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'] as const

export const MAX_SERIES = 8
export const MAX_ROWS = 50
export const MAX_LABEL_LENGTH = 60

export interface ChartSeries {
  name: string
  values: number[]
  tone: ChartTone | null
}

export interface ChartData {
  labels: string[]
  series: ChartSeries[]
}

export const isChartType = (v: unknown): v is ChartType => (CHART_TYPES as readonly unknown[]).includes(v)
export const chartTypeOf = (v: unknown): ChartType => (isChartType(v) ? v : 'column')
export const toneOfChart = (v: unknown): ChartTone | null => ((CHART_TONES as readonly unknown[]).includes(v) ? (v as ChartTone) : null)

/** Palette slot (0-based) for a series: its tone, else its position. */
export function paletteIndex(tone: ChartTone | null | undefined, index: number): number {
  const t = toneOfChart(tone)
  return t ? CHART_TONES.indexOf(t) : ((index % CHART_HEX.length) + CHART_HEX.length) % CHART_HEX.length
}

/** CSS colour for a palette slot, theme-aware through the design tokens, hex outside the app. */
export function paletteColor(slot: number): string {
  const i = ((slot % CHART_HEX.length) + CHART_HEX.length) % CHART_HEX.length
  return `var(--color-lh-chart-${i + 1}, ${CHART_HEX[i]})`
}

export const seriesColor = (series: Pick<ChartSeries, 'tone'> | undefined, index: number) => paletteColor(paletteIndex(series?.tone ?? null, index))

const toNumber = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') {
    const n = parseNumber(v)
    return n === null ? 0 : n
  }
  return 0
}

const cleanLabel = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, MAX_LABEL_LENGTH) : '')

/**
 * Whatever is stored (AI, imports, older drafts) as a well-formed data set:
 * string labels, at most MAX_SERIES series of numbers, each as long as the
 * labels (padded with 0 or cut).
 */
export function normalizeChartData(raw: unknown): ChartData {
  const obj = raw && typeof raw === 'object' ? (raw as any) : {}
  const labels = (Array.isArray(obj.labels) ? obj.labels : []).slice(0, MAX_ROWS).map(cleanLabel)
  const series: ChartSeries[] = (Array.isArray(obj.series) ? obj.series : [])
    .filter((s: unknown) => s && typeof s === 'object')
    .slice(0, MAX_SERIES)
    .map((s: any) => {
      const values = (Array.isArray(s.values) ? s.values : []).slice(0, labels.length).map(toNumber)
      while (values.length < labels.length) values.push(0)
      return { name: cleanLabel(s.name), values, tone: toneOfChart(s.tone) }
    })
  return { labels, series }
}

export const isEmptyChart = (data: ChartData) => !data.labels.length || !data.series.length

// ── Numbers ───────────────────────────────────────────────────────────────

/**
 * A number typed by a person or pasted from a sheet: "1,234.5", "1 234,5",
 * "12%", "$40", "-3". Returns null when there is no number.
 */
export function parseNumber(input: string): number | null {
  let s = String(input ?? '')
    .trim()
    .replace(/[\s\u00a0\u202f']/g, '')
    .replace(/^[^\d+\-.,(]+/, '')
    .replace(/[^\d.,)]+$/, '')
  if (!s) return null
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }
  if (s.startsWith('-')) {
    negative = !negative
    s = s.slice(1)
  } else if (s.startsWith('+')) s = s.slice(1)
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null
  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  if (lastDot !== -1 && lastComma !== -1) {
    // Both: the later one is the decimal separator.
    const dec = lastDot > lastComma ? '.' : ','
    const thousands = dec === '.' ? ',' : '.'
    s = s.split(thousands).join('').replace(dec, '.')
  } else if (lastComma !== -1) {
    const parts = s.split(',')
    // "1,234" / "1,234,567" are thousands; "3,5" / "12,75" are decimals.
    s = parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0] !== '0') ? parts.join('') : parts.join('.')
  } else if ((s.match(/\./g) ?? []).length > 1) {
    s = s.split('.').join('')
  }
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return negative ? -n : n
}

/** 1, 2 or 5 times a power of ten, close to `range` (Heckbert's nice numbers). */
export function niceNumber(range: number, round: boolean): number {
  if (!(range > 0) || !Number.isFinite(range)) return 1
  const exponent = Math.floor(Math.log10(range))
  const fraction = range / 10 ** exponent
  let nice: number
  if (round) nice = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10
  else nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10
  return nice * 10 ** exponent
}

const roundTo = (v: number, step: number) => {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1)
  return Number(v.toFixed(Math.min(decimals, 12)))
}

export interface Ticks {
  min: number
  max: number
  step: number
  ticks: number[]
}

/**
 * Round axis bounds and evenly spaced ticks covering [min, max]. The axis
 * always holds 0 (bars grow from it); an all-equal range still gets a span.
 */
export function niceTicks(minValue: number, maxValue: number, maxTicks = 5): Ticks {
  let lo = Math.min(0, Number.isFinite(minValue) ? minValue : 0)
  let hi = Math.max(0, Number.isFinite(maxValue) ? maxValue : 0)
  if (lo === hi) hi = lo + 1
  const count = Math.max(2, Math.floor(maxTicks))
  const range = niceNumber(hi - lo, false)
  const step = niceNumber(range / (count - 1), true)
  lo = Math.floor(lo / step) * step
  hi = Math.ceil(hi / step) * step
  const ticks: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(roundTo(v, step) === 0 ? 0 : roundTo(v, step))
  return { min: roundTo(lo, step), max: roundTo(hi, step), step, ticks }
}

/** Short tick text: 1200 → "1.2k", 0.25 → "0.25", 3000000 → "3M". */
export function formatTick(value: number, step = 1): string {
  const abs = Math.abs(value)
  const units: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'k'],
  ]
  for (const [size, suffix] of units) {
    if (abs >= size && step >= size / 10) {
      const v = value / size
      return `${Number(v.toFixed(Math.abs(v) < 10 && step < size ? 1 : 0))}${suffix}`
    }
  }
  const decimals = step >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(step)))
  return String(Number(value.toFixed(decimals)))
}

/** A value as people read it: grouped digits, up to 2 decimals. */
export function formatValue(value: number, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)
  } catch {
    return String(value)
  }
}

/** Short value text for labels on the marks: 12500 → "12.5K", 4.567 → "4.57". */
export function formatCompact(value: number, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, Math.abs(value) >= 10000 ? { notation: 'compact', maximumFractionDigits: 1 } : { maximumFractionDigits: 2 }).format(value)
  } catch {
    return String(value)
  }
}

// ── Scales ────────────────────────────────────────────────────────────────

export type Scale = (_v: number) => number

export function linearScale([d0, d1]: [number, number], [r0, r1]: [number, number]): Scale {
  const span = d1 - d0 || 1
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0)
}

export interface BandScale {
  bandwidth: number
  step: number
  /** Start of band i. */
  start: (_i: number) => number
  /** Centre of band i. */
  center: (_i: number) => number
}

/** `count` equal bands across [start, end] with gaps between and around them. */
export function bandScale(count: number, start: number, end: number, paddingInner = 0.25, paddingOuter = 0.15): BandScale {
  const n = Math.max(1, count)
  const step = (end - start) / Math.max(1e-9, n - paddingInner + paddingOuter * 2)
  const bandwidth = step * (1 - paddingInner)
  const offset = start + step * paddingOuter
  return {
    bandwidth,
    step,
    start: (i: number) => offset + i * step,
    center: (i: number) => offset + i * step + bandwidth / 2,
  }
}

/** The value range the axis must cover (stacked: positive and negative sums per label). */
export function valueExtent(data: ChartData, stacked: boolean): [number, number] {
  let min = 0
  let max = 0
  if (stacked) {
    data.labels.forEach((_l, j) => {
      let pos = 0
      let neg = 0
      for (const s of data.series) {
        const v = s.values[j] ?? 0
        if (v >= 0) pos += v
        else neg += v
      }
      max = Math.max(max, pos)
      min = Math.min(min, neg)
    })
  } else {
    for (const s of data.series) for (const v of s.values) {
      max = Math.max(max, v)
      min = Math.min(min, v)
    }
  }
  return [min, max]
}

/**
 * [base, top] of every series at every label when stacked: positives pile up
 * from 0, negatives down from 0.
 */
export function stackSeries(data: ChartData): [number, number][][] {
  const pos = data.labels.map(() => 0)
  const neg = data.labels.map(() => 0)
  return data.series.map((s) =>
    data.labels.map((_l, j) => {
      const v = s.values[j] ?? 0
      if (v >= 0) {
        const base = pos[j]
        pos[j] += v
        return [base, pos[j]] as [number, number]
      }
      const base = neg[j]
      neg[j] += v
      return [base, neg[j]] as [number, number]
    }),
  )
}

// ── Paths ─────────────────────────────────────────────────────────────────

const r2 = (n: number) => Math.round(n * 100) / 100

export function linePath(points: [number, number][]): string {
  return points.map(([x, y], i) => `${i ? 'L' : 'M'}${r2(x)} ${r2(y)}`).join('')
}

/** A closed area between a top line and a base line (both left to right). */
export function areaPath(top: [number, number][], base: [number, number][]): string {
  if (!top.length) return ''
  const back = [...base].reverse()
  return `${linePath(top)}${back.map(([x, y]) => `L${r2(x)} ${r2(y)}`).join('')}Z`
}

const polar = (cx: number, cy: number, r: number, angle: number): [number, number] => [cx + r * Math.cos(angle), cy + r * Math.sin(angle)]

/**
 * A pie or donut slice from angle a0 to a1 (radians, 0 = 3 o'clock,
 * clockwise). A full turn is drawn as two halves, since one SVG arc cannot
 * close on itself.
 */
export function arcPath(cx: number, cy: number, outer: number, inner: number, a0: number, a1: number): string {
  const sweep = a1 - a0
  if (sweep <= 0) return ''
  if (sweep >= Math.PI * 2 - 1e-6) {
    const mid = a0 + Math.PI
    return arcPath(cx, cy, outer, inner, a0, mid) + arcPath(cx, cy, outer, inner, mid, a0 + Math.PI * 2)
  }
  const large = sweep > Math.PI ? 1 : 0
  const [x0, y0] = polar(cx, cy, outer, a0)
  const [x1, y1] = polar(cx, cy, outer, a1)
  if (inner <= 0) {
    return `M${r2(cx)} ${r2(cy)}L${r2(x0)} ${r2(y0)}A${r2(outer)} ${r2(outer)} 0 ${large} 1 ${r2(x1)} ${r2(y1)}Z`
  }
  const [x2, y2] = polar(cx, cy, inner, a1)
  const [x3, y3] = polar(cx, cy, inner, a0)
  return `M${r2(x0)} ${r2(y0)}A${r2(outer)} ${r2(outer)} 0 ${large} 1 ${r2(x1)} ${r2(y1)}L${r2(x2)} ${r2(y2)}A${r2(inner)} ${r2(inner)} 0 ${large} 0 ${r2(x3)} ${r2(y3)}Z`
}

// ── CSV ───────────────────────────────────────────────────────────────────

/** The delimiter of a pasted table: tab, semicolon or comma, whichever the first line uses most. */
export function detectDelimiter(text: string): string {
  const first = String(text ?? '').split(/\r?\n/).find((l) => l.trim()) ?? ''
  const count = (ch: string) => {
    let n = 0
    let quoted = false
    for (const c of first) {
      if (c === '"') quoted = !quoted
      else if (c === ch && !quoted) n++
    }
    return n
  }
  const scores: [string, number][] = [
    ['\t', count('\t')],
    [';', count(';')],
    [',', count(',')],
  ]
  scores.sort((a, b) => b[1] - a[1])
  return scores[0][1] > 0 ? scores[0][0] : ','
}

/** RFC 4180-ish CSV/TSV: quoted fields, "" escapes, CRLF; blank lines dropped. */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = String(text ?? '')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === delimiter) {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.map((r) => r.map((f) => f.trim())).filter((r) => r.some((f) => f !== ''))
}

/**
 * A pasted sheet as chart data. The first column holds the labels; the first
 * row is the header (series names) unless its cells are all numbers.
 */
export function csvToChartData(text: string, seriesName: (_i: number) => string = (i) => `Series ${i + 1}`): ChartData | null {
  const rows = parseCsv(text)
  if (!rows.length) return null
  const width = Math.max(...rows.map((r) => r.length))
  if (width < 2) {
    // One column of numbers: a single unnamed series.
    const values = rows.map((r) => parseNumber(r[0]))
    if (values.some((v) => v === null)) return null
    return normalizeChartData({ labels: values.map((_v, i) => String(i + 1)), series: [{ name: seriesName(0), values }] })
  }
  const head = rows[0]
  const hasHeader = head.slice(1).some((c) => c !== '' && parseNumber(c) === null)
  const body = hasHeader ? rows.slice(1) : rows
  if (!body.length) return null
  const names = Array.from({ length: width - 1 }, (_v, i) => (hasHeader && head[i + 1]) || seriesName(i))
  return normalizeChartData({
    labels: body.map((r) => r[0] ?? ''),
    series: names.map((name, i) => ({ name, values: body.map((r) => parseNumber(r[i + 1] ?? '') ?? 0) })),
  })
}

const csvField = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

/** The data as CSV (header row of series names), for copying out or editing as text. */
export function chartDataToCsv(data: ChartData, labelHeader = ''): string {
  const lines = [[labelHeader, ...data.series.map((s) => s.name)]]
  data.labels.forEach((label, j) => lines.push([label, ...data.series.map((s) => String(s.values[j] ?? 0))]))
  return lines.map((l) => l.map(csvField).join(',')).join('\n')
}

// ── Editing helpers (the data grid) ───────────────────────────────────────

export function addRow(data: ChartData, label: string): ChartData {
  if (data.labels.length >= MAX_ROWS) return data
  return { labels: [...data.labels, label], series: data.series.map((s) => ({ ...s, values: [...s.values, 0] })) }
}

export function removeRow(data: ChartData, index: number): ChartData {
  if (data.labels.length <= 1 || index < 0 || index >= data.labels.length) return data
  return {
    labels: data.labels.filter((_l, i) => i !== index),
    series: data.series.map((s) => ({ ...s, values: s.values.filter((_v, i) => i !== index) })),
  }
}

export function addSeries(data: ChartData, name: string): ChartData {
  if (data.series.length >= MAX_SERIES) return data
  return { ...data, series: [...data.series, { name, values: data.labels.map(() => 0), tone: null }] }
}

export function removeSeries(data: ChartData, index: number): ChartData {
  if (data.series.length <= 1 || index < 0 || index >= data.series.length) return data
  return { ...data, series: data.series.filter((_s, i) => i !== index) }
}

export function setCell(data: ChartData, series: number, row: number, value: number): ChartData {
  if (!data.series[series] || row < 0 || row >= data.labels.length || !Number.isFinite(value)) return data
  return { ...data, series: data.series.map((s, i) => (i === series ? { ...s, values: s.values.map((v, j) => (j === row ? value : v)) } : s)) }
}

export function setLabel(data: ChartData, row: number, label: string): ChartData {
  if (row < 0 || row >= data.labels.length) return data
  return { ...data, labels: data.labels.map((l, j) => (j === row ? cleanLabel(label) : l)) }
}

export function setSeries(data: ChartData, index: number, patch: Partial<Pick<ChartSeries, 'name' | 'tone'>>): ChartData {
  if (!data.series[index]) return data
  return {
    ...data,
    series: data.series.map((s, i) =>
      i === index ? { ...s, ...(patch.name !== undefined ? { name: cleanLabel(patch.name) } : {}), ...(patch.tone !== undefined ? { tone: toneOfChart(patch.tone) } : {}) } : s,
    ),
  }
}

// ── Geometry ──────────────────────────────────────────────────────────────

export interface ChartOptions {
  type: ChartType
  stacked?: boolean
  showValues?: boolean
  width?: number
  height?: number
}

export interface ChartTick {
  value: number
  text: string
  /** Pixel position along the value axis. */
  pos: number
}

export interface CategoryTick {
  index: number
  text: string
  pos: number
  /** False when labels would collide; the label is skipped. */
  visible: boolean
}

export interface ChartMark {
  series: number
  index: number
  value: number
  color: string
  /** Rect for bars and columns. */
  x: number
  y: number
  w: number
  h: number
  /** Anchor for the tooltip and the value label. */
  cx: number
  cy: number
  shape: 'rect' | 'point'
}

export interface ChartLine {
  series: number
  color: string
  line: string
  area: string | null
}

export interface ChartSlice {
  index: number
  value: number
  share: number
  color: string
  d: string
  /** Centroid for the label and the tooltip. */
  cx: number
  cy: number
}

export interface CartesianGeometry {
  kind: 'cartesian'
  type: Exclude<ChartType, 'pie' | 'donut'>
  width: number
  height: number
  plot: { x: number; y: number; w: number; h: number }
  /** 'y' for columns, lines and areas; 'x' for horizontal bars. */
  valueAxis: 'x' | 'y'
  valueTicks: ChartTick[]
  categoryTicks: CategoryTick[]
  zero: number
  marks: ChartMark[]
  lines: ChartLine[]
}

export interface PieGeometry {
  kind: 'pie'
  type: 'pie' | 'donut'
  width: number
  height: number
  cx: number
  cy: number
  outer: number
  inner: number
  total: number
  slices: ChartSlice[]
}

export type ChartGeometry = CartesianGeometry | PieGeometry

export const CHART_HEIGHT = 300
export const CHART_HEIGHT_NARROW = 240
export const CHART_DEFAULT_WIDTH = 640

/** Height for a container width: shorter on phones. */
export const chartHeightFor = (width: number) => (width < 420 ? CHART_HEIGHT_NARROW : CHART_HEIGHT)

const CHAR_W = 6.6 // approximate width of an 11px label character

const ellipsize = (text: string, maxChars: number) => (text.length > maxChars ? `${text.slice(0, Math.max(1, maxChars - 1))}…` : text)

export function layoutChart(data: ChartData, options: ChartOptions): ChartGeometry {
  const type = chartTypeOf(options.type)
  const width = Math.max(200, Math.round(options.width ?? CHART_DEFAULT_WIDTH))
  const height = Math.max(160, Math.round(options.height ?? chartHeightFor(width)))
  if (type === 'pie' || type === 'donut') return layoutPie(data, type, width, height)
  return layoutCartesian(data, type, width, height, !!options.stacked, !!options.showValues)
}

function layoutPie(data: ChartData, type: 'pie' | 'donut', width: number, height: number): PieGeometry {
  // A pie shows the first series, one slice per label.
  const series = data.series[0]
  const values = data.labels.map((_l, i) => Math.max(0, series?.values[i] ?? 0))
  const total = values.reduce((a, b) => a + b, 0)
  const pad = 12
  const outer = Math.max(20, Math.min(width, height) / 2 - pad)
  const inner = type === 'donut' ? outer * 0.6 : 0
  const cx = width / 2
  const cy = height / 2
  let angle = -Math.PI / 2
  const slices: ChartSlice[] = values.map((value, index) => {
    const share = total > 0 ? value / total : 0
    const a0 = angle
    const a1 = angle + share * Math.PI * 2
    angle = a1
    const mid = (a0 + a1) / 2
    const labelR = inner > 0 ? (outer + inner) / 2 : outer * 0.62
    return {
      index,
      value,
      share,
      color: paletteColor(index),
      d: share > 0 ? arcPath(cx, cy, outer, inner, a0, a1) : '',
      cx: r2(cx + labelR * Math.cos(mid)),
      cy: r2(cy + labelR * Math.sin(mid)),
    }
  })
  return { kind: 'pie', type, width, height, cx, cy, outer, inner, total, slices }
}

function layoutCartesian(data: ChartData, type: CartesianGeometry['type'], width: number, height: number, stackedOpt: boolean, showValues: boolean): CartesianGeometry {
  const stacked = stackedOpt && data.series.length > 1
  const [vmin, vmax] = valueExtent(data, stacked)
  const horizontal = type === 'bar'
  const ticks = niceTicks(vmin, vmax, horizontal ? Math.max(3, Math.min(6, Math.floor(width / 110))) : height < 260 ? 4 : 5)
  const tickTexts = ticks.ticks.map((v) => formatTick(v, ticks.step))
  const longestTick = Math.max(...tickTexts.map((t) => t.length))
  const longestLabel = Math.max(1, ...data.labels.map((l) => l.length))
  const top = showValues ? 18 : 10
  const right = horizontal && showValues ? 34 : 12
  let left: number
  let bottom: number
  if (horizontal) {
    left = Math.min(Math.round(width * 0.32), Math.max(36, Math.ceil(longestLabel * CHAR_W) + 12))
    bottom = 26
  } else {
    left = Math.max(28, Math.ceil(longestTick * CHAR_W) + 12)
    bottom = 28
  }
  const plot = { x: left, y: top, w: Math.max(40, width - left - right), h: Math.max(40, height - top - bottom) }
  const value: Scale = horizontal ? linearScale([ticks.min, ticks.max], [plot.x, plot.x + plot.w]) : linearScale([ticks.min, ticks.max], [plot.y + plot.h, plot.y])
  const zero = value(0)
  const valueTicks: ChartTick[] = ticks.ticks.map((v, i) => ({ value: v, text: tickTexts[i], pos: r2(value(v)) }))

  const n = data.labels.length
  const lineLike = type === 'line' || type === 'area'
  // Lines run edge to edge; bars sit in bands.
  const band = bandScale(n, horizontal ? plot.y : plot.x, horizontal ? plot.y + plot.h : plot.x + plot.w, lineLike ? 0 : 0.3, lineLike ? 0 : 0.15)
  const point = (i: number) => {
    if (!lineLike) return band.center(i)
    if (n <= 1) return plot.x + plot.w / 2
    return plot.x + (plot.w * i) / (n - 1)
  }

  // Category labels: skip some when they would overlap.
  const room = horizontal ? 14 : n > 1 ? (lineLike ? plot.w / (n - 1) : band.step) : plot.w
  const labelChars = horizontal ? Math.max(3, Math.floor((left - 10) / CHAR_W)) : Math.max(3, Math.floor(Math.max(room, 40) / CHAR_W))
  const need = horizontal ? 14 : Math.min(longestLabel, labelChars) * CHAR_W + 8
  const every = Math.max(1, Math.ceil(need / Math.max(1, room)))
  const categoryTicks: CategoryTick[] = data.labels.map((label, index) => ({
    index,
    text: ellipsize(label, labelChars),
    pos: r2(point(index)),
    visible: index % every === 0,
  }))

  const marks: ChartMark[] = []
  const lines: ChartLine[] = []
  const stack = stacked ? stackSeries(data) : null
  const sCount = data.series.length

  if (!lineLike) {
    const inner = stacked || sCount <= 1 ? band.bandwidth : band.bandwidth / sCount
    data.series.forEach((s, si) => {
      const color = seriesColor(s, si)
      s.values.forEach((v, j) => {
        const [b, t] = stack ? stack[si][j] : [0, v]
        const p0 = value(b)
        const p1 = value(t)
        const along = band.start(j) + (stacked || sCount <= 1 ? 0 : si * inner)
        const thick = Math.max(1, inner - (stacked || sCount <= 1 ? 0 : Math.min(2, inner * 0.12)))
        if (horizontal) {
          const x = Math.min(p0, p1)
          const w = Math.abs(p1 - p0)
          marks.push({ series: si, index: j, value: v, color, x: r2(x), y: r2(along), w: r2(w), h: r2(thick), cx: r2(v >= 0 ? x + w : x), cy: r2(along + thick / 2), shape: 'rect' })
        } else {
          const y = Math.min(p0, p1)
          const h = Math.abs(p1 - p0)
          marks.push({ series: si, index: j, value: v, color, x: r2(along), y: r2(y), w: r2(thick), h: r2(h), cx: r2(along + thick / 2), cy: r2(v >= 0 ? y : y + h), shape: 'rect' })
        }
      })
    })
  } else {
    data.series.forEach((s, si) => {
      const color = seriesColor(s, si)
      const topPts: [number, number][] = s.values.map((v, j) => [point(j), value(stack ? stack[si][j][1] : v)])
      const basePts: [number, number][] = s.values.map((_v, j) => [point(j), stack ? value(stack[si][j][0]) : zero])
      lines.push({ series: si, color, line: linePath(topPts), area: type === 'area' ? areaPath(topPts, basePts) : null })
      s.values.forEach((v, j) => {
        const [x, y] = topPts[j]
        marks.push({ series: si, index: j, value: v, color, x: r2(x), y: r2(y), w: 0, h: 0, cx: r2(x), cy: r2(y), shape: 'point' })
      })
    })
  }

  return { kind: 'cartesian', type, width, height, plot, valueAxis: horizontal ? 'x' : 'y', valueTicks, categoryTicks, zero: r2(zero), marks, lines }
}

// ── Text for assistive tech ───────────────────────────────────────────────

export interface ChartText {
  /** "{{type}} chart" style names per chart type. */
  typeName: (_type: ChartType) => string
  /** Summary sentence; receives the counts and range. */
  summary: (_p: { type: string; series: number; categories: number; min: string; max: string; names: string }) => string
  fallbackTitle: string
  category: string
  /** "Q1, Class A: 72" */
  point: (_p: { label: string; series: string; value: string }) => string
  /** "Q1: 72 (34%)" */
  slice: (_p: { label: string; value: string; percent: string }) => string
}

export const DEFAULT_CHART_TEXT: ChartText = {
  typeName: (type) => ({ bar: 'Bar chart', column: 'Column chart', line: 'Line chart', area: 'Area chart', pie: 'Pie chart', donut: 'Donut chart' })[type],
  summary: ({ type, series, categories, min, max, names }) => `${type} of ${series} series (${names}) over ${categories} categories, from ${min} to ${max}.`,
  fallbackTitle: 'Chart',
  category: 'Category',
  point: ({ label, series, value }) => `${label}, ${series}: ${value}`,
  slice: ({ label, value, percent }) => `${label}: ${value} (${percent})`,
}

export function chartSummary(data: ChartData, type: ChartType, text: ChartText = DEFAULT_CHART_TEXT, locale?: string): string {
  const values = data.series.flatMap((s) => s.values)
  const min = values.length ? Math.min(...values) : 0
  const max = values.length ? Math.max(...values) : 0
  return text.summary({
    type: text.typeName(type),
    series: data.series.length,
    categories: data.labels.length,
    min: formatValue(min, locale),
    max: formatValue(max, locale),
    names: data.series.map((s) => s.name).filter(Boolean).join(', '),
  })
}

export const formatPercent = (share: number, locale?: string) => {
  try {
    return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: share < 0.1 ? 1 : 0 }).format(share)
  } catch {
    return `${Math.round(share * 100)}%`
  }
}

/** The accessible label of one mark. */
export function markLabel(data: ChartData, geometry: ChartGeometry, series: number, index: number, text: ChartText = DEFAULT_CHART_TEXT, locale?: string): string {
  const label = data.labels[index] ?? ''
  if (geometry.kind === 'pie') {
    const slice = geometry.slices[index]
    return text.slice({ label, value: formatValue(slice?.value ?? 0, locale), percent: formatPercent(slice?.share ?? 0, locale) })
  }
  return text.point({ label, series: data.series[series]?.name ?? '', value: formatValue(data.series[series]?.values[index] ?? 0, locale) })
}

// ── SVG as a DOMOutputSpec tree ───────────────────────────────────────────

/** [tag, attrs, ...children]: the shape renderHTML returns, also turned into React elements by the view. */
export type SvgSpec = [string, Record<string, string>, ...(SvgSpec | string)[]]

const AXIS_TEXT = 'fill:var(--lhc-axis, #8a8984)'
const GRID = 'stroke:var(--lhc-grid, #efefed)'
const SURFACE = 'var(--lhc-surface, #ffffff)'

export interface ChartSvgOptions {
  title: string
  desc: string
  data: ChartData
  showValues?: boolean
  text?: ChartText
  locale?: string
  /** Index of the highlighted mark ("series-index"), if any. */
  active?: string | null
}

/**
 * The chart as an SVG tree. Every mark carries `data-mark="series-index"`,
 * is focusable and has an aria-label, so the view adds tooltips by event
 * delegation and the server markup is already accessible.
 */
export function chartSvg(geometry: ChartGeometry, opts: ChartSvgOptions): SvgSpec {
  const text = opts.text ?? DEFAULT_CHART_TEXT
  const children: (SvgSpec | string)[] = [
    ['title', {}, opts.title],
    ['desc', {}, opts.desc],
  ]
  const markAttrs = (series: number, index: number): Record<string, string> => {
    const key = `${series}-${index}`
    return {
      'data-mark': key,
      tabindex: '0',
      role: 'img',
      'aria-label': markLabel(opts.data, geometry, series, index, text, opts.locale),
      class: `lh-chart-mark${opts.active === key ? ' is-active' : ''}`,
    }
  }

  if (geometry.kind === 'pie') {
    const g: SvgSpec = ['g', { class: 'lh-chart-slices' }]
    geometry.slices.forEach((s) => {
      if (!s.d) return
      g.push(['path', { ...markAttrs(0, s.index), d: s.d, style: `fill:${s.color};stroke:${SURFACE};stroke-width:2` }])
    })
    children.push(g)
    if (opts.showValues) {
      const labels: SvgSpec = ['g', { class: 'lh-chart-values', 'aria-hidden': 'true' }]
      geometry.slices.forEach((s) => {
        if (s.share < 0.06) return
        labels.push(['text', { x: String(s.cx), y: String(s.cy), 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'lh-chart-slice-label', style: 'fill:#ffffff;font-size:11px;font-weight:600' }, formatPercent(s.share, opts.locale)])
      })
      children.push(labels)
    }
    if (geometry.type === 'donut' && geometry.total > 0) {
      children.push(['text', { x: String(geometry.cx), y: String(geometry.cy), 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'lh-chart-total', 'aria-hidden': 'true', style: 'fill:var(--lhc-ink, #262626);font-size:18px;font-weight:600' }, formatValue(geometry.total, opts.locale)])
    }
    return ['svg', { xmlns: 'http://www.w3.org/2000/svg', width: String(geometry.width), height: String(geometry.height), viewBox: `0 0 ${geometry.width} ${geometry.height}`, role: 'img', class: 'lh-chart-svg' }, ...children]
  }

  const { plot } = geometry
  const grid: SvgSpec = ['g', { class: 'lh-chart-grid', 'aria-hidden': 'true' }]
  const axis: SvgSpec = ['g', { class: 'lh-chart-axis', 'aria-hidden': 'true', style: 'font-size:11px' }]
  for (const tick of geometry.valueTicks) {
    if (geometry.valueAxis === 'y') {
      grid.push(['line', { x1: String(plot.x), x2: String(plot.x + plot.w), y1: String(tick.pos), y2: String(tick.pos), style: GRID }])
      axis.push(['text', { x: String(plot.x - 8), y: String(tick.pos), 'text-anchor': 'end', 'dominant-baseline': 'central', style: AXIS_TEXT }, tick.text])
    } else {
      grid.push(['line', { y1: String(plot.y), y2: String(plot.y + plot.h), x1: String(tick.pos), x2: String(tick.pos), style: GRID }])
      axis.push(['text', { x: String(tick.pos), y: String(plot.y + plot.h + 16), 'text-anchor': 'middle', style: AXIS_TEXT }, tick.text])
    }
  }
  for (const c of geometry.categoryTicks) {
    if (!c.visible) continue
    if (geometry.valueAxis === 'y') axis.push(['text', { x: String(c.pos), y: String(plot.y + plot.h + 18), 'text-anchor': 'middle', style: AXIS_TEXT }, c.text])
    else axis.push(['text', { x: String(plot.x - 8), y: String(c.pos), 'text-anchor': 'end', 'dominant-baseline': 'central', style: AXIS_TEXT }, c.text])
  }
  // The zero line, a little stronger than the grid.
  const zeroLine: SvgSpec =
    geometry.valueAxis === 'y'
      ? ['line', { x1: String(plot.x), x2: String(plot.x + plot.w), y1: String(geometry.zero), y2: String(geometry.zero), class: 'lh-chart-zero', 'aria-hidden': 'true', style: 'stroke:var(--lhc-axis, #8a8984);stroke-opacity:0.45' }]
      : ['line', { y1: String(plot.y), y2: String(plot.y + plot.h), x1: String(geometry.zero), x2: String(geometry.zero), class: 'lh-chart-zero', 'aria-hidden': 'true', style: 'stroke:var(--lhc-axis, #8a8984);stroke-opacity:0.45' }]
  children.push(grid, axis)

  const series: SvgSpec = ['g', { class: 'lh-chart-series' }]
  for (const line of geometry.lines) {
    if (line.area) series.push(['path', { d: line.area, class: 'lh-chart-area', 'aria-hidden': 'true', style: `fill:${line.color};fill-opacity:0.18;stroke:none` }])
    series.push(['path', { d: line.line, class: 'lh-chart-line', 'aria-hidden': 'true', style: `fill:none;stroke:${line.color};stroke-width:2.25;stroke-linejoin:round;stroke-linecap:round` }])
  }
  for (const m of geometry.marks) {
    if (m.shape === 'rect') {
      series.push(['rect', { ...markAttrs(m.series, m.index), x: String(m.x), y: String(m.y), width: String(m.w), height: String(m.h), rx: String(Math.min(3, m.w / 2, m.h / 2)), style: `fill:${m.color}` }])
    } else {
      series.push(['circle', { ...markAttrs(m.series, m.index), cx: String(m.cx), cy: String(m.cy), r: '4', style: `fill:${SURFACE};stroke:${m.color};stroke-width:2` }])
    }
  }
  children.push(series, zeroLine)

  if (opts.showValues) {
    const values: SvgSpec = ['g', { class: 'lh-chart-values', 'aria-hidden': 'true', style: 'font-size:10.5px;font-weight:600' }]
    for (const m of geometry.marks) {
      const label = formatCompact(m.value, opts.locale)
      if (geometry.valueAxis === 'y') values.push(['text', { x: String(m.cx), y: String(m.value >= 0 ? m.cy - 6 : m.cy + 13), 'text-anchor': 'middle', style: AXIS_TEXT }, label])
      else values.push(['text', { x: String(m.value >= 0 ? m.cx + 5 : m.cx - 5), y: String(m.cy), 'text-anchor': m.value >= 0 ? 'start' : 'end', 'dominant-baseline': 'central', style: AXIS_TEXT }, label])
    }
    children.push(values)
  }

  return ['svg', { xmlns: 'http://www.w3.org/2000/svg', width: String(geometry.width), height: String(geometry.height), viewBox: `0 0 ${geometry.width} ${geometry.height}`, role: 'img', class: 'lh-chart-svg' }, ...children]
}

/** The visually hidden data table read by screen readers (and shown when there is no CSS). */
export function chartTable(data: ChartData, caption: string, text: ChartText = DEFAULT_CHART_TEXT, locale?: string): SvgSpec {
  const head: SvgSpec = ['tr', {}, ['th', { scope: 'col' }, text.category], ...data.series.map((s, i): SvgSpec => ['th', { scope: 'col' }, s.name || `${i + 1}`])]
  const rows = data.labels.map((label, j): SvgSpec => ['tr', {}, ['th', { scope: 'row' }, label], ...data.series.map((s): SvgSpec => ['td', {}, formatValue(s.values[j] ?? 0, locale)])])
  return ['table', { class: 'lh-chart-table sr-only' }, ['caption', {}, caption], ['thead', {}, head], ['tbody', {}, ...rows]]
}

/** Starter data for the slash menu: quarterly scores for two classes. */
export function sampleChartData(t: (_key: string, _fallback: string) => string): ChartData {
  return {
    labels: [t('editor.blocks_v2.chart.sample.q1', 'Q1'), t('editor.blocks_v2.chart.sample.q2', 'Q2'), t('editor.blocks_v2.chart.sample.q3', 'Q3'), t('editor.blocks_v2.chart.sample.q4', 'Q4')],
    series: [
      { name: t('editor.blocks_v2.chart.sample.series_1', 'Class A'), values: [68, 74, 79, 86], tone: 'blue' },
      { name: t('editor.blocks_v2.chart.sample.series_2', 'Class B'), values: [62, 70, 72, 81], tone: 'teal' },
    ],
  }
}
