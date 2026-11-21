/*
 Table editing commands used by the floating table bar (TableControls).
 Each takes the editor, applies one transaction and returns whether it ran.
 None of them moves focus, so they can run from a popover.
*/
import type { Editor } from '@tiptap/core'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { CellSelection, TableMap } from '@tiptap/pm/tables'

export type CellScope = 'selection' | 'column'

export interface TableAt {
  node: PMNode
  pos: number
  start: number
}

export function findTable(state: EditorState): TableAt | null {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type.name === 'table') return { node, pos: $from.before(d), start: $from.start(d) }
  }
  return null
}

const isCell = (node: PMNode | null | undefined) => !!node && (node.type.name === 'tableCell' || node.type.name === 'tableHeader')

/** Position of the cell holding the caret (or the anchor of a cell selection). */
export function currentCellPos(state: EditorState): number | null {
  const sel = state.selection
  if (sel instanceof CellSelection) return sel.$anchorCell.pos
  const { $from } = sel
  for (let d = $from.depth; d > 0; d--) if (isCell($from.node(d))) return $from.before(d)
  return null
}

export function currentCellAttrs(state: EditorState): Record<string, any> | null {
  const pos = currentCellPos(state)
  return pos == null ? null : (state.doc.nodeAt(pos)?.attrs ?? null)
}

/** Positions of the targeted cells: the selected ones, or every cell of their columns. */
export function targetCellPositions(state: EditorState, scope: CellScope, opts: { skipHeaders?: boolean } = {}): number[] {
  const table = findTable(state)
  if (!table) return []
  const sel = state.selection
  const map = TableMap.get(table.node)
  const out = new Set<number>()
  if (scope === 'selection') {
    if (sel instanceof CellSelection) sel.forEachCell((_cell, pos) => out.add(pos))
    else {
      const pos = currentCellPos(state)
      if (pos != null) out.add(pos)
    }
  } else {
    let rect: { left: number; right: number }
    if (sel instanceof CellSelection) {
      rect = map.rectBetween(sel.$anchorCell.pos - table.start, sel.$headCell.pos - table.start)
    } else {
      const pos = currentCellPos(state)
      if (pos == null) return []
      rect = map.findCell(pos - table.start)
    }
    for (let row = 0; row < map.height; row++) {
      for (let col = rect.left; col < rect.right; col++) out.add(table.start + map.map[row * map.width + col])
    }
  }
  return [...out].filter((pos) => {
    const node = state.doc.nodeAt(pos)
    return isCell(node) && !(opts.skipHeaders && scope === 'column' && node!.type.name === 'tableHeader')
  })
}

function run(editor: Editor, build: (_tr: Transaction, _state: EditorState) => boolean): boolean {
  const { state, view } = editor
  const tr = state.tr
  if (!build(tr, state)) return false
  view.dispatch(tr)
  return true
}

export function setCellsAttrs(editor: Editor, attrs: Record<string, any>, scope: CellScope = 'selection', opts: { skipHeaders?: boolean } = {}): boolean {
  return run(editor, (tr, state) => {
    const positions = targetCellPositions(state, scope, opts)
    for (const pos of positions) {
      const node = tr.doc.nodeAt(pos)
      if (node) tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs })
    }
    return positions.length > 0
  })
}

/** Sets the type of the targeted cells; a column keeps its header cells as text. */
export function setCellType(editor: Editor, cellType: string, scope: CellScope): boolean {
  return setCellsAttrs(editor, { cellType }, scope, { skipHeaders: true })
}

export function setTableAttrs(editor: Editor, attrs: Record<string, any>): boolean {
  return run(editor, (tr, state) => {
    const table = findTable(state)
    if (!table) return false
    tr.setNodeMarkup(table.pos, undefined, { ...table.node.attrs, ...attrs })
    return true
  })
}

/** Gives every column the same width (clears stored widths). */
export function distributeColumns(editor: Editor): boolean {
  return run(editor, (tr, state) => {
    const table = findTable(state)
    if (!table) return false
    let changed = false
    table.node.descendants((node, offset) => {
      if (isCell(node)) {
        if (node.attrs.colwidth) {
          tr.setNodeMarkup(table.start + offset, undefined, { ...node.attrs, colwidth: null })
          changed = true
        }
        return false
      }
      return true
    })
    return changed
  })
}

/** Inserts a copy of the current row below it (body cells, same content). */
export function duplicateRow(editor: Editor): boolean {
  const { state } = editor
  const table = findTable(state)
  if (!table) return false
  let spans = false
  table.node.descendants((node) => {
    if (isCell(node) && node.attrs.rowspan > 1) spans = true
    return !isCell(node)
  })
  // Row spans make a copy ambiguous; fall back to an empty row.
  if (spans) return editor.commands.addRowAfter()
  const pos = currentCellPos(state)
  if (pos == null) return false
  const $cell = state.doc.resolve(pos)
  const row = $cell.parent
  const rowEnd = $cell.after()
  const cellType = state.schema.nodes.tableCell
  const cells: PMNode[] = []
  row.forEach((cell) => cells.push(cell.type.name === 'tableHeader' && cellType ? cellType.create(cell.attrs, cell.content, cell.marks) : cell))
  return run(editor, (tr) => {
    tr.insert(rowEnd, row.type.create(row.attrs, cells))
    return true
  })
}

/**
 * Header row / header column toggles for the FIRST row or column. (The stock
 * commands toggle the row or column holding the selection, which is not what
 * a "Header row" switch means.) A corner cell stays a header while the other
 * header line is on. The column toggle also records `headerColumn`.
 */
function toggleHeaderLine(editor: Editor, line: 'row' | 'column'): boolean {
  return run(editor, (tr, state) => {
    const table = findTable(state)
    if (!table) return false
    const { tableCell, tableHeader } = state.schema.nodes
    if (!tableCell || !tableHeader) return false
    const map = TableMap.get(table.node)
    const on = line === 'row' ? !hasHeaderRow(state) : !hasHeaderColumn(state)
    const otherOn = line === 'row' ? hasHeaderColumn(state) : hasHeaderRow(state)
    const count = line === 'row' ? map.width : map.height
    const seen = new Set<number>()
    for (let i = 0; i < count; i++) {
      const rel = line === 'row' ? map.map[i] : map.map[i * map.width]
      if (seen.has(rel)) continue
      seen.add(rel)
      if (!on && i === 0 && otherOn) continue
      const pos = table.start + rel
      const node = tr.doc.nodeAt(pos)
      const type = on ? tableHeader : tableCell
      if (node && node.type !== type) tr.setNodeMarkup(pos, type, node.attrs, node.marks)
    }
    if (line === 'column') tr.setNodeMarkup(table.pos, undefined, { ...table.node.attrs, headerColumn: on })
    return true
  })
}

export const toggleHeaderRow = (editor: Editor) => toggleHeaderLine(editor, 'row')
export const toggleHeaderColumn = (editor: Editor) => toggleHeaderLine(editor, 'column')

const allHeaders = (row: PMNode | null | undefined) => {
  if (!row || row.childCount === 0) return false
  let all = true
  row.forEach((cell) => {
    if (cell.type.name !== 'tableHeader') all = false
  })
  return all
}

export function hasHeaderRow(state: EditorState): boolean {
  return allHeaders(findTable(state)?.node.firstChild)
}

/** The first column is headers (looking past a header row). */
export function hasHeaderColumn(state: EditorState): boolean {
  const table = findTable(state)
  if (!table) return false
  const rows: PMNode[] = []
  table.node.forEach((row) => rows.push(row))
  const body = rows.length > 1 && allHeaders(rows[0]) ? rows.slice(1) : rows
  return body.length > 0 && body.every((row) => row.firstChild?.type.name === 'tableHeader')
}
