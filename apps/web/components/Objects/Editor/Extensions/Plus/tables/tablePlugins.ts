/*
 Editor-only table behaviour:
 - typed cells: a decoration keeps each typed cell's visual attrs in step
   with its text while the author types (renderHTML only runs when a cell is
   created), marks the cell holding the caret, and puts a toggle button in
   checkbox cells;
 - paste: tab- or comma-separated text pasted on an empty line becomes a
   table, the first row a header row when it reads like one.
*/
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import { cellTypeOf, toggledCheckboxText, typedCellAttrs } from './tableAttrs'
import { buildTableJSON, looksLikeHeader, parseDelimited } from './tableModel'

export const typedCellsKey = new PluginKey<DecorationSet>('lhTypedCells')

function isCell(node: PMNode) {
  return node.type.name === 'tableCell' || node.type.name === 'tableHeader'
}

export function buildTypedCellDecorations(state: EditorState, toggleLabel: () => string): DecorationSet {
  const decos: Decoration[] = []
  const { $from } = state.selection
  let caretCell = -1
  for (let d = $from.depth; d > 0; d--) {
    if (isCell($from.node(d))) {
      caretCell = $from.before(d)
      break
    }
  }
  state.doc.descendants((node, pos) => {
    if (node.isTextblock) return false
    if (!isCell(node)) return true
    const type = cellTypeOf(node.attrs)
    if (type === 'text') return false
    // Decorations can only set attributes, so values that went away (the
    // text was cleared) are set empty to override what renderHTML wrote.
    // An empty aria-label is ignored by screen readers (accname rules).
    const attrs: Record<string, string> = {
      'aria-label': '',
      'data-lh-display': '',
      'data-lh-state': '',
      'data-lh-tone': '',
      ...(type === 'progress' ? { style: 'background-size: 0% 6px, 100% 6px' } : {}),
      ...typedCellAttrs(node.attrs, node.textContent),
    }
    if (pos === caretCell) attrs.class = 'lh-cell-editing'
    decos.push(Decoration.node(pos, pos + node.nodeSize, attrs))
    if (type === 'checkbox' && node.firstChild?.isTextblock) {
      const checked = attrs['data-lh-state'] === 'on'
      decos.push(
        Decoration.widget(pos + 2, (view: EditorView, getPos) => {
          const button = document.createElement('button')
          button.type = 'button'
          button.className = 'lh-cell-check'
          button.contentEditable = 'false'
          button.setAttribute('aria-pressed', String(checked))
          button.setAttribute('aria-label', toggleLabel())
          button.title = toggleLabel()
          button.textContent = checked ? '✓' : ''
          button.addEventListener('mousedown', (e) => e.preventDefault())
          button.addEventListener('click', (e) => {
            e.preventDefault()
            const at = getPos()
            if (at == null) return
            toggleCheckboxCell(view, at - 2)
          })
          return button
        }, { side: -1, ignoreSelection: true, stopEvent: () => true, key: `chk-${pos}-${checked}` }),
      )
    }
    return false
  })
  return DecorationSet.create(state.doc, decos)
}

/** Flips a checkbox cell's text (yes ↔ no, ✓ ↔ ✗, …). */
export function toggleCheckboxCell(view: EditorView, cellPos: number): boolean {
  const cell = view.state.doc.nodeAt(cellPos)
  if (!cell || !isCell(cell) || !cell.firstChild?.isTextblock) return false
  const block = cell.firstChild
  const next = toggledCheckboxText(block.textContent)
  const from = cellPos + 2
  const to = from + block.content.size
  view.dispatch(view.state.tr.insertText(next, from, to))
  return true
}

/** A table node from pasted delimited text, or null. */
export function tableFromText(schema: Schema, text: string): PMNode | null {
  const rows = parseDelimited(text)
  if (!rows || !schema.nodes.table) return null
  try {
    return schema.nodeFromJSON(buildTableJSON(rows, { header: looksLikeHeader(rows) }))
  } catch {
    return null
  }
}

function insideTable(state: EditorState): boolean {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'table') return true
  return false
}

export function createTableEditing(opts: { toggleLabel: () => string }) {
  return Extension.create({
    name: 'lhTableEditing',

    addProseMirrorPlugins() {
      return [
        new Plugin<DecorationSet>({
          key: typedCellsKey,
          state: {
            init: (_, state) => buildTypedCellDecorations(state, opts.toggleLabel),
            apply: (tr, old, _oldState, state) =>
              tr.docChanged || tr.selectionSet ? buildTypedCellDecorations(state, opts.toggleLabel) : old.map(tr.mapping, tr.doc),
          },
          props: {
            decorations: (state) => typedCellsKey.getState(state),
          },
        }),
        new Plugin({
          key: new PluginKey('lhTablePaste'),
          props: {
            handlePaste(view, event) {
              const data = event.clipboardData
              if (!data) return false
              const html = data.getData('text/html')
              // Spreadsheets also put an HTML <table> on the clipboard; the
              // stock paste already turns that into a table.
              if (html && /<table[\s>]/i.test(html)) return false
              const text = data.getData('text/plain')
              const { state } = view
              const { $from, empty } = state.selection
              if (!empty || !text || insideTable(state)) return false
              const parent = $from.parent
              if (parent.type.name !== 'paragraph' || parent.content.size !== 0) return false
              const table = tableFromText(state.schema, text)
              if (!table) return false
              const from = $from.before()
              const tr = state.tr.replaceWith(from, from + parent.nodeSize, table)
              tr.setSelection(TextSelection.near(tr.doc.resolve(from + 3)))
              view.dispatch(tr.scrollIntoView())
              return true
            },
          },
        }),
      ]
    },
  })
}
