// Pure logic for the "Property grid" experience (node `expMatrix`): stored
// attrs, author validation and edits, learner toggles, checking and stars.
// No React, so it is unit-tested directly (tests/experiences-matrix.test.mjs).
//
// Stored shape:
//   { blockId, title, instructions, mode: 'multi' | 'single',
//     rows: [{ id, label }],            // 2–8
//     columns: [{ id, label }],         // 2–6
//     cells: { "rowId:colId": true } }  // the correct ticks

import { asArray, starsFromRatio } from '../shared/utils'

export interface MatrixRow {
  id: string
  label: string
}

export type MatrixColumn = MatrixRow
export type MatrixMode = 'multi' | 'single'

export interface MatrixData {
  blockId: string
  title: string
  instructions: string
  rows: MatrixRow[]
  columns: MatrixColumn[]
  cells: Record<string, boolean>
  mode: MatrixMode
}

export const MATRIX_LIMITS = { minRows: 2, maxRows: 8, minColumns: 2, maxColumns: 6 } as const

type T = (_key: string, _fallback: string) => string
const identityT: T = (_k, fallback) => fallback

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback)

export const cellKey = (rowId: string, colId: string) => `${rowId}:${colId}`

function normalizeList(raw: unknown, prefix: string): MatrixRow[] {
  const seen = new Set<string>()
  return asArray<any>(raw)
    .filter((x) => x && typeof x === 'object')
    .map((x, i) => {
      // ':' separates row and column in cell keys, so it never appears in an id.
      let id = (str(x.id, `${prefix}${i + 1}`) || `${prefix}${i + 1}`).replace(/:/g, '_')
      while (seen.has(id)) id = `${id}_${i}`
      seen.add(id)
      return { id, label: str(x.label) }
    })
}

function normalizeCells(raw: unknown): Record<string, boolean> {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      value = null
    }
  }
  const out: Record<string, boolean> = {}
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    Object.entries(value as Record<string, unknown>).forEach(([k, v]) => {
      if (v === true && k.includes(':')) out[k] = true
    })
  }
  return out
}

/** Guard whatever is stored (AI output, collab peers, pasted HTML) into the shape the UI expects. */
export function normalizeMatrix(attrs: any): MatrixData {
  const rows = normalizeList(attrs?.rows, 'r')
  const columns = normalizeList(attrs?.columns, 'c')
  const rowIds = new Set(rows.map((r) => r.id))
  const colIds = new Set(columns.map((c) => c.id))
  const cells: Record<string, boolean> = {}
  Object.keys(normalizeCells(attrs?.cells)).forEach((k) => {
    const at = k.indexOf(':')
    if (rowIds.has(k.slice(0, at)) && colIds.has(k.slice(at + 1))) cells[k] = true
  })
  return {
    blockId: str(attrs?.blockId),
    title: str(attrs?.title),
    instructions: str(attrs?.instructions),
    rows,
    columns,
    cells,
    mode: attrs?.mode === 'single' ? 'single' : 'multi',
  }
}

/** The filled-in example a new block starts with; same content and keys as the registry's insert. */
export function exampleMatrix(t: T = identityT): Omit<MatrixData, 'blockId'> {
  const k = (key: string, fallback: string) => t(`editor.experiences.matrix.example.${key}`, fallback)
  return {
    title: k('title', 'Which animal does what?'),
    instructions: k('instructions', 'Tick every property that fits each animal.'),
    mode: 'multi',
    rows: [
      { id: 'r1', label: k('penguin', 'Penguin') },
      { id: 'r2', label: k('bat', 'Bat') },
      { id: 'r3', label: k('dolphin', 'Dolphin') },
      { id: 'r4', label: k('duck', 'Duck') },
    ],
    columns: [
      { id: 'c1', label: k('eggs', 'Lays eggs') },
      { id: 'c2', label: k('fur', 'Has fur') },
      { id: 'c3', label: k('flies', 'Can fly') },
      { id: 'c4', label: k('swims', 'Swims') },
    ],
    cells: { 'r1:c1': true, 'r1:c4': true, 'r2:c2': true, 'r2:c3': true, 'r3:c4': true, 'r4:c1': true, 'r4:c3': true, 'r4:c4': true },
  }
}

// ─── Author validation ──────────────────────────────────────────────────────

export type MatrixIssueCode =
  | 'too_few_rows'
  | 'too_many_rows'
  | 'too_few_columns'
  | 'too_many_columns'
  | 'empty_row'
  | 'empty_column'
  | 'row_no_tick'
  | 'row_not_one'
  | 'unused_column'
  | 'duplicate_row'
  | 'duplicate_column'

export interface MatrixIssue {
  code: MatrixIssueCode
  /** The row or column the hint belongs to (absent for block-level issues). */
  id?: string
  severity: 'error' | 'warning'
}

export function rowTicks(data: Pick<MatrixData, 'columns' | 'cells'>, rowId: string): string[] {
  return data.columns.filter((c) => data.cells[cellKey(rowId, c.id)]).map((c) => c.id)
}

export function validateMatrix(data: MatrixData): MatrixIssue[] {
  const issues: MatrixIssue[] = []
  const { rows, columns } = data
  if (rows.length < MATRIX_LIMITS.minRows) issues.push({ code: 'too_few_rows', severity: 'error' })
  if (rows.length > MATRIX_LIMITS.maxRows) issues.push({ code: 'too_many_rows', severity: 'warning' })
  if (columns.length < MATRIX_LIMITS.minColumns) issues.push({ code: 'too_few_columns', severity: 'error' })
  if (columns.length > MATRIX_LIMITS.maxColumns) issues.push({ code: 'too_many_columns', severity: 'warning' })
  const dup = (list: MatrixRow[], code: MatrixIssueCode) => {
    const seen = new Set<string>()
    list.forEach((x) => {
      const key = x.label.trim().toLowerCase()
      if (!key) return
      if (seen.has(key)) issues.push({ code, id: x.id, severity: 'warning' })
      seen.add(key)
    })
  }
  rows.forEach((r) => {
    if (!r.label.trim()) issues.push({ code: 'empty_row', id: r.id, severity: 'error' })
    const ticks = rowTicks(data, r.id).length
    if (data.mode === 'single' && ticks !== 1) issues.push({ code: 'row_not_one', id: r.id, severity: 'error' })
    else if (data.mode === 'multi' && ticks === 0) issues.push({ code: 'row_no_tick', id: r.id, severity: 'warning' })
  })
  columns.forEach((c) => {
    if (!c.label.trim()) issues.push({ code: 'empty_column', id: c.id, severity: 'error' })
    else if (!rows.some((r) => data.cells[cellKey(r.id, c.id)])) issues.push({ code: 'unused_column', id: c.id, severity: 'warning' })
  })
  dup(rows, 'duplicate_row')
  dup(columns, 'duplicate_column')
  return issues
}

/**
 * What learners play: unnamed rows and columns are skipped, and in single
 * mode a row without exactly one correct tick is left out (it has no answer).
 */
export function playableMatrix(data: MatrixData): MatrixData {
  const columns = data.columns.filter((c) => c.label.trim()).slice(0, MATRIX_LIMITS.maxColumns)
  let rows = data.rows.filter((r) => r.label.trim())
  if (data.mode === 'single') rows = rows.filter((r) => columns.filter((c) => data.cells[cellKey(r.id, c.id)]).length === 1)
  rows = rows.slice(0, MATRIX_LIMITS.maxRows)
  const cells: Record<string, boolean> = {}
  rows.forEach((r) => columns.forEach((c) => data.cells[cellKey(r.id, c.id)] && (cells[cellKey(r.id, c.id)] = true)))
  return { ...data, rows, columns, cells }
}

export function isPlayable(data: MatrixData): boolean {
  const p = playableMatrix(data)
  return p.rows.length >= MATRIX_LIMITS.minRows && p.columns.length >= MATRIX_LIMITS.minColumns
}

// ─── Author edits (immutable) ───────────────────────────────────────────────

function dropCells(cells: Record<string, boolean>, keep: (_k: string) => boolean): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  Object.keys(cells).forEach((k) => keep(k) && (out[k] = true))
  return out
}

export function addRow(data: MatrixData, id: string, label = ''): MatrixData {
  if (data.rows.length >= MATRIX_LIMITS.maxRows) return data
  return { ...data, rows: [...data.rows, { id, label }] }
}

export function removeRow(data: MatrixData, id: string): MatrixData {
  if (data.rows.length <= MATRIX_LIMITS.minRows) return data
  return { ...data, rows: data.rows.filter((r) => r.id !== id), cells: dropCells(data.cells, (k) => !k.startsWith(`${id}:`)) }
}

export function updateRow(data: MatrixData, id: string, label: string): MatrixData {
  return { ...data, rows: data.rows.map((r) => (r.id === id ? { ...r, label } : r)) }
}

export function addColumn(data: MatrixData, id: string, label = ''): MatrixData {
  if (data.columns.length >= MATRIX_LIMITS.maxColumns) return data
  return { ...data, columns: [...data.columns, { id, label }] }
}

export function removeColumn(data: MatrixData, id: string): MatrixData {
  if (data.columns.length <= MATRIX_LIMITS.minColumns) return data
  return { ...data, columns: data.columns.filter((c) => c.id !== id), cells: dropCells(data.cells, (k) => !k.endsWith(`:${id}`)) }
}

export function updateColumn(data: MatrixData, id: string, label: string): MatrixData {
  return { ...data, columns: data.columns.map((c) => (c.id === id ? { ...c, label } : c)) }
}

/** Toggle a correct tick. In single mode the row's tick moves to this column. */
export function toggleAnswerCell(data: MatrixData, rowId: string, colId: string): MatrixData {
  const key = cellKey(rowId, colId)
  if (data.mode === 'single') {
    const cells = dropCells(data.cells, (k) => !k.startsWith(`${rowId}:`))
    cells[key] = true
    return { ...data, cells }
  }
  const cells = { ...data.cells }
  if (cells[key]) delete cells[key]
  else cells[key] = true
  return { ...data, cells }
}

// ─── Learner ────────────────────────────────────────────────────────────────

/** The learner's ticks, keyed like `cells`. */
export type MatrixAnswers = Record<string, boolean>

export function toggleAnswer(data: Pick<MatrixData, 'mode' | 'columns'>, answers: MatrixAnswers, rowId: string, colId: string): MatrixAnswers {
  const key = cellKey(rowId, colId)
  if (data.mode === 'single') {
    const next = dropCells(answers, (k) => !k.startsWith(`${rowId}:`))
    if (!answers[key]) next[key] = true
    return next
  }
  const next = { ...answers }
  if (next[key]) delete next[key]
  else next[key] = true
  return next
}

/** tick: ticked and right · wrong: ticked but not right · missed: should be ticked · blank: correctly empty. */
export type CellResult = 'tick' | 'wrong' | 'missed' | 'blank'

export interface MatrixCheck {
  results: Record<string, CellResult>
  /** Per row: every cell of the row is right. */
  rowsCorrect: Record<string, boolean>
  correct: number
  total: number
  stars: 0 | 1 | 2 | 3
  perfect: boolean
}

/** Multi mode scores every cell; single mode scores rows. */
export function checkMatrix(data: MatrixData, answers: MatrixAnswers): MatrixCheck {
  const results: Record<string, CellResult> = {}
  const rowsCorrect: Record<string, boolean> = {}
  let goodCells = 0
  data.rows.forEach((r) => {
    let rowOk = true
    data.columns.forEach((c) => {
      const key = cellKey(r.id, c.id)
      const want = !!data.cells[key]
      const got = !!answers[key]
      const res: CellResult = want && got ? 'tick' : got ? 'wrong' : want ? 'missed' : 'blank'
      results[key] = res
      if (res === 'tick' || res === 'blank') goodCells++
      else rowOk = false
    })
    rowsCorrect[r.id] = rowOk
  })
  const single = data.mode === 'single'
  const total = single ? data.rows.length : data.rows.length * data.columns.length
  const correct = single ? data.rows.filter((r) => rowsCorrect[r.id]).length : goodCells
  return { results, rowsCorrect, correct, total, stars: total ? starsFromRatio(correct / total) : 0, perfect: total > 0 && correct === total }
}

/** Single mode: Check once every row has a pick. Multi mode: once anything is ticked. */
export function canCheck(data: MatrixData, answers: MatrixAnswers): boolean {
  if (data.mode === 'single') return data.rows.every((r) => data.columns.some((c) => answers[cellKey(r.id, c.id)]))
  return Object.values(answers).some(Boolean)
}

/** "Retry wrong ones": right ticks stay; wrong ticks are cleared (single mode: wrong rows are cleared). */
export function retryWrong(data: MatrixData, answers: MatrixAnswers, check: MatrixCheck): MatrixAnswers {
  const next: MatrixAnswers = {}
  Object.keys(answers).forEach((k) => {
    if (!answers[k]) return
    const rowId = k.slice(0, k.indexOf(':'))
    if (data.mode === 'single' ? check.rowsCorrect[rowId] : check.results[k] === 'tick') next[k] = true
  })
  return next
}

/** Next cell for arrow keys in a rows × cols grid (clamped at the edges). */
export function moveFocus(at: { r: number; c: number }, key: string, rows: number, cols: number, rtl = false): { r: number; c: number } | null {
  let { r, c } = at
  if (key === 'ArrowUp') r--
  else if (key === 'ArrowDown') r++
  else if (key === 'ArrowLeft') c += rtl ? 1 : -1
  else if (key === 'ArrowRight') c += rtl ? -1 : 1
  else if (key === 'Home') c = 0
  else if (key === 'End') c = cols - 1
  else return null
  if (r < 0 || r >= rows || c < 0 || c >= cols) return null
  return { r, c }
}
