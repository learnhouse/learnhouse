/*
 Document operations for flipcards and flipcard grids. Each one is a single
 transaction (one undo step, one collab update) that touches only the nodes it
 has to: a move is one delete + one insert, never a rewrite of the grid.
*/
import type { Editor } from '@tiptap/core'

export const NEW_CARD_TEXT = { question: '', answer: '' }

/** Where a card sits: its grid's position and its index in that grid. */
export function cardPlace(editor: Editor, pos: number | null | undefined) {
  if (typeof pos !== 'number') return null
  try {
    const $pos = editor.state.doc.resolve(pos)
    if ($pos.parent.type.name !== 'flipcardGrid' || $pos.depth < 1) return null
    return { gridPos: $pos.before(), index: $pos.index(), grid: $pos.parent }
  } catch {
    return null
  }
}

function childOffset(grid: any, index: number) {
  let off = 0
  for (let i = 0; i < index; i++) off += grid.child(i).nodeSize
  return off
}

export function moveCardInGrid(editor: Editor, gridPos: number, from: number, to: number) {
  return editor
    .chain()
    .command(({ tr }) => {
      const grid = tr.doc.nodeAt(gridPos)
      if (!grid || grid.type.name !== 'flipcardGrid') return false
      if (from === to || from < 0 || to < 0 || from >= grid.childCount || to >= grid.childCount) return false
      const card = grid.child(from)
      const fromPos = gridPos + 1 + childOffset(grid, from)
      tr.delete(fromPos, fromPos + card.nodeSize)
      const after = tr.doc.nodeAt(gridPos)!
      tr.insert(gridPos + 1 + childOffset(after, to), card)
      return true
    })
    .run()
}

/** Insert a card after `index` (or at the end) carrying the given attrs. Returns its index. */
export function insertCard(editor: Editor, gridPos: number, attrs: Record<string, unknown>, afterIndex?: number) {
  let at = -1
  editor
    .chain()
    .command(({ tr, state }) => {
      const grid = tr.doc.nodeAt(gridPos)
      const type = state.schema.nodes.flipcard
      if (!grid || !type) return false
      at = afterIndex === undefined ? grid.childCount : Math.min(grid.childCount, afterIndex + 1)
      tr.insert(gridPos + 1 + childOffset(grid, at), type.create(attrs))
      return true
    })
    .run()
  return at
}

/** Delete one card; the last card of a grid takes the (empty) grid with it. */
export function deleteCard(editor: Editor, gridPos: number, index: number) {
  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      const grid = tr.doc.nodeAt(gridPos)
      if (!grid) return false
      if (grid.childCount <= 1) {
        tr.delete(gridPos, gridPos + grid.nodeSize)
        return true
      }
      const from = gridPos + 1 + childOffset(grid, index)
      tr.delete(from, from + grid.child(index).nodeSize)
      return true
    })
    .run()
}

/** Same colour / style / size on every card of a grid, in one step. */
export function applyToAllCards(editor: Editor, gridPos: number, patch: Record<string, unknown>) {
  return editor
    .chain()
    .command(({ tr }) => {
      const grid = tr.doc.nodeAt(gridPos)
      if (!grid) return false
      let pos = gridPos + 1
      grid.forEach((card) => {
        tr.setNodeMarkup(pos, undefined, { ...card.attrs, ...patch })
        pos += card.nodeSize
      })
      return true
    })
    .run()
}

export function groupIntoGrid(editor: Editor, pos: number) {
  return editor
    .chain()
    .focus()
    .command(({ tr, state }) => {
      const node = tr.doc.nodeAt(pos)
      const gridType = state.schema.nodes.flipcardGrid
      if (!node || !gridType) return false
      tr.replaceWith(pos, pos + node.nodeSize, gridType.create({ columns: 2 }, node))
      return true
    })
    .run()
}

export function ungroupGrid(editor: Editor, gridPos: number) {
  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      const node = tr.doc.nodeAt(gridPos)
      if (!node) return false
      tr.replaceWith(gridPos, gridPos + node.nodeSize, node.content)
      return true
    })
    .run()
}

// A card that should take focus when its node view mounts (a newly added
// card's front text).
let pendingFocus: { gridPos: number; index: number; target: 'text' } | null = null
export const requestCardFocus = (gridPos: number, index: number, target: 'text') => {
  pendingFocus = { gridPos, index, target }
}
export function takeCardFocus(gridPos: number, index: number): 'text' | null {
  if (!pendingFocus || pendingFocus.gridPos !== gridPos || pendingFocus.index !== index) return null
  const t = pendingFocus.target
  pendingFocus = null
  return t
}
