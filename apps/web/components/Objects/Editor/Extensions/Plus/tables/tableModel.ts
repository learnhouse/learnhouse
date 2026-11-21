/*
 Pure table logic shared by the editor view, the learner view, the static
 renderer and the tests: reading a table's columns, sorting rows by a typed
 column, the totals footer, and turning pasted TSV/CSV into a table.
*/
import {
  cellTypeOf,
  formatNumber,
  normalizeCurrency,
  parseNumber,
  parseProgress,
  typedSortKey,
  NUMBER_FORMATS,
  type CellType,
  type NumberFormat,
  type TableTotals,
} from './tableAttrs'

/** The parts of a ProseMirror node this module reads. */
export interface NodeLike {
  type: { name: string }
  attrs: Record<string, any>
  textContent: string
  childCount: number
  child: (_index: number) => NodeLike
}

export interface ModelCell {
  col: number
  colspan: number
  rowspan: number
  header: boolean
  type: CellType
  text: string
  attrs: Record<string, any>
}

export interface ModelRow {
  /** Every cell is a header cell: stays on top when sorting. */
  header: boolean
  cells: ModelCell[]
}

export interface TableModel {
  rows: ModelRow[]
  width: number
  /** Leading rows made only of header cells. */
  headerRows: number
  /** Per column: its typed cell type (the body cells' shared type) or 'text'. */
  columnTypes: CellType[]
  /** Header text per column, for sort menus and card labels. */
  columnLabels: string[]
  /** False when row spans make reordering rows unsafe. */
  canSort: boolean
}

export function readTableModel(table: NodeLike): TableModel {
  const rows: ModelRow[] = []
  // Columns still covered by a rowspan from a row above.
  const covered: number[] = []
  let width = 0
  let canSort = true
  for (let r = 0; r < table.childCount; r++) {
    const rowNode = table.child(r)
    const cells: ModelCell[] = []
    let col = 0
    for (let c = 0; c < rowNode.childCount; c++) {
      while ((covered[col] ?? 0) > 0) col++
      const cell = rowNode.child(c)
      const colspan = Math.max(1, Number(cell.attrs.colspan) || 1)
      const rowspan = Math.max(1, Number(cell.attrs.rowspan) || 1)
      cells.push({
        col,
        colspan,
        rowspan,
        header: cell.type.name === 'tableHeader',
        type: cellTypeOf(cell.attrs),
        text: cell.textContent,
        attrs: cell.attrs,
      })
      if (rowspan > 1) {
        canSort = false
        for (let k = 0; k < colspan; k++) covered[col + k] = rowspan
      }
      col += colspan
    }
    for (let k = 0; k < covered.length; k++) if (covered[k] > 0) covered[k]--
    width = Math.max(width, col)
    rows.push({ header: cells.length > 0 && cells.every((cell) => cell.header), cells })
  }
  let headerRows = 0
  while (headerRows < rows.length && rows[headerRows].header) headerRows++

  const columnTypes: CellType[] = []
  const columnLabels: string[] = []
  for (let col = 0; col < width; col++) {
    const types = new Set<CellType>()
    for (const row of rows.slice(headerRows)) {
      const cell = row.cells.find((x) => x.col === col && x.colspan === 1)
      if (cell && !cell.header && cell.type !== 'text') types.add(cell.type)
    }
    columnTypes.push(types.size === 1 ? [...types][0] : 'text')
    const head = headerRows > 0 ? rows[headerRows - 1].cells.find((x) => x.col <= col && col < x.col + x.colspan) : null
    columnLabels.push(head?.text.trim() || '')
  }
  return { rows, width, headerRows, columnTypes, columnLabels, canSort }
}

export type SortDir = 'asc' | 'desc'

function cellAt(row: ModelRow, col: number): ModelCell | undefined {
  return row.cells.find((x) => x.col <= col && col < x.col + x.colspan)
}

/**
 * The row order for sorting by `col`: header rows stay first, empty values
 * go last in both directions, and equal values keep their order (stable).
 */
export function sortRowOrder(model: TableModel, col: number, dir: SortDir): number[] {
  const head = Array.from({ length: model.headerRows }, (_, i) => i)
  const body = model.rows.map((_, i) => i).slice(model.headerRows)
  if (!model.canSort || col < 0 || col >= model.width) return [...head, ...body]
  const keyed = body.map((index) => {
    const cell = cellAt(model.rows[index], col)
    // A column of one type compares by that type; stray cells by their text.
    const attrs = cell ? { ...cell.attrs, cellType: model.columnTypes[col] !== 'text' ? model.columnTypes[col] : cell.type } : {}
    return { index, key: cell ? typedSortKey(attrs, cell.text) : null }
  })
  const sign = dir === 'asc' ? 1 : -1
  keyed.sort((a, b) => {
    if (a.key == null || b.key == null) return a.key == null ? (b.key == null ? a.index - b.index : 1) : -1
    let d: number
    if (typeof a.key === 'number' && typeof b.key === 'number') d = a.key - b.key
    else if (typeof a.key === 'number') d = -1
    else if (typeof b.key === 'number') d = 1
    else d = a.key.localeCompare(b.key, undefined, { numeric: true, sensitivity: 'base' })
    return d === 0 ? a.index - b.index : d * sign
  })
  return [...head, ...keyed.map((k) => k.index)]
}

export interface TotalsRow {
  /** Column that carries the "Total"/"Average" label, or -1. */
  labelCol: number
  /** Formatted value per column (null = empty cell). */
  values: (string | null)[]
}

/**
 * The totals footer: sum or average of each number column, and the average
 * of each progress column (a sum of percentages means nothing, so progress
 * always averages). Null when the table has no column to total.
 */
export function computeTotals(model: TableModel, mode: TableTotals, locale?: string): TotalsRow | null {
  if (mode !== 'sum' && mode !== 'average') return null
  const values: (string | null)[] = Array(model.width).fill(null)
  let any = false
  for (let col = 0; col < model.width; col++) {
    const type = model.columnTypes[col]
    if (type !== 'number' && type !== 'progress') continue
    const nums: number[] = []
    let format: NumberFormat | null = null
    let currency: string | null = null
    for (const row of model.rows.slice(model.headerRows)) {
      const cell = row.cells.find((x) => x.col === col && x.colspan === 1)
      if (!cell || cell.header) continue
      const n = type === 'progress' ? parseProgress(cell.text) : parseNumber(cell.text)
      if (n != null) nums.push(n)
      format ??= (NUMBER_FORMATS as readonly string[]).includes(cell.attrs.numberFormat) ? cell.attrs.numberFormat : null
      currency ??= normalizeCurrency(cell.attrs.currency)
    }
    if (!nums.length) continue
    any = true
    const sum = nums.reduce((a, b) => a + b, 0)
    if (type === 'progress') {
      values[col] = `${formatNumber(Math.round((sum / nums.length) * 10) / 10, null, null, locale)}%`
    } else {
      const v = mode === 'sum' ? sum : sum / nums.length
      values[col] = formatNumber(Math.round(v * 100) / 100, format, currency, locale)
    }
  }
  if (!any) return null
  const labelCol = values.findIndex((v) => v == null)
  return { labelCol, values }
}

// ─── Paste ─────────────────────────────────────────────────────────────────

function parseCsvLine(line: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"' && cur.trim() === '') {
      quoted = true
      cur = ''
    } else if (ch === sep) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  out.push(cur.trim())
  return out
}

/** Splits text into lines, keeping newlines that sit inside quoted fields. */
function splitRecords(text: string): string[] {
  const lines: string[] = []
  let cur = ''
  let quoted = false
  for (const ch of text.replace(/\r\n?/g, '\n')) {
    if (ch === '"') quoted = !quoted
    if (ch === '\n' && !quoted) {
      lines.push(cur)
      cur = ''
    } else cur += ch
  }
  lines.push(cur)
  return lines.filter((l) => l.trim() !== '')
}

/**
 * Tab- or comma-separated text → rows of cells, or null when the text isn't
 * clearly a table (fewer than 2 rows or 2 columns, or ragged comma rows,
 * which are usually prose with commas in it).
 */
export function parseDelimited(text: string): string[][] | null {
  if (typeof text !== 'string' || text.length > 200_000) return null
  const records = splitRecords(text.trim())
  if (records.length < 2) return null
  const tabbed = records.some((r) => r.includes('\t'))
  const sep = tabbed ? '\t' : records.every((r) => r.includes(';')) && !records.every((r) => r.includes(',')) ? ';' : ','
  if (!tabbed && !records.every((r) => r.includes(sep))) return null
  const rows = records.map((r) => parseCsvLine(r, sep))
  const width = Math.max(...rows.map((r) => r.length))
  if (width < 2 || width > 30 || rows.length > 500) return null
  // Comma data must be rectangular; tab data (spreadsheets) may be ragged.
  if (!tabbed && rows.some((r) => r.length !== width)) return null
  return rows.map((r) => [...r, ...Array(width - r.length).fill('')])
}

/** The first row reads as a header: all labels, distinct, and not numbers. */
export function looksLikeHeader(rows: string[][]): boolean {
  if (rows.length < 2) return false
  const first = rows[0]
  if (first.some((c) => !c.trim())) return false
  if (first.some((c) => parseNumber(c) != null)) return false
  if (new Set(first.map((c) => c.trim().toLowerCase())).size !== first.length) return false
  // A body column of numbers under a text label is the strongest signal;
  // otherwise accept short labels (a header rarely runs long).
  const numericBody = first.some((_, col) => rows.slice(1).every((r) => parseNumber(r[col] ?? '') != null))
  return numericBody || first.every((c) => c.length <= 40)
}

// ─── JSON builders (paste, templates) ──────────────────────────────────────

export interface CellSpec {
  text: string
  attrs?: Record<string, any>
}

const cellJSON = (type: 'tableCell' | 'tableHeader', spec: CellSpec) => ({
  type,
  ...(spec.attrs ? { attrs: spec.attrs } : {}),
  content: [spec.text ? { type: 'paragraph', content: [{ type: 'text', text: spec.text }] } : { type: 'paragraph' }],
})

/** Table JSON from rows of cells; the first row becomes header cells when asked. */
export function buildTableJSON(rows: (string | CellSpec)[][], opts: { header?: boolean; attrs?: Record<string, any> } = {}) {
  return {
    type: 'table',
    ...(opts.attrs ? { attrs: opts.attrs } : {}),
    content: rows.map((row, r) => ({
      type: 'tableRow',
      content: row.map((cell) => cellJSON(opts.header && r === 0 ? 'tableHeader' : 'tableCell', typeof cell === 'string' ? { text: cell } : cell)),
    })),
  }
}

/** Escapes text for a CSS `content: "…"` string. */
export function cssString(text: string): string {
  return `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r\f]/g, '\\A ').replace(/</g, '\\3C ')}"`
}

/**
 * Per-table CSS for the cards variant: each body cell is labelled with its
 * column header on phones. Scoped to the table's id.
 */
export function cardLabelsCss(id: string, model: TableModel): string {
  const safeId = id.replace(/[^\w-]/g, '')
  return model.columnLabels
    .map((label, i) => (label ? `#${safeId} tr > :nth-child(${i + 1})::before{content:${cssString(label)}}` : ''))
    .filter(Boolean)
    .join('')
}
