/*
 The stock Table, TableRow, TableHeader and TableCell, extended in place
 (same node names) with the Editor Plus attrs. With every attr at its
 default the HTML is exactly the stock HTML.
*/
import { mergeAttributes } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'
import { Table } from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import { CELL_EXTRA_ATTRS, TABLE_EXTRA_ATTRS, typedCellAttrs } from './tableAttrs'
import { computeTotals, readTableModel } from './tableModel'
import { DEFAULT_TABLE_LABELS, PlusTableView, type TableViewLabels } from './tableView'
import { makeStaticTable } from './StaticTable'
import type { PlusMode } from '../types'

export interface TableNodesOptions {
  mode: PlusMode
  labels?: () => TableViewLabels
}

export function createTableNodes({ mode, labels = () => DEFAULT_TABLE_LABELS }: TableNodesOptions) {
  const learner = mode !== 'editor'
  const StaticTable = makeStaticTable(labels)

  const PlusTable = Table.extend({
    addAttributes() {
      return { ...this.parent?.(), ...TABLE_EXTRA_ATTRS }
    },

    parseHTML() {
      return [
        ...(this.parent?.() ?? [{ tag: 'table' }]),
        // Our own output, not content: the caption is an attr, the totals
        // row is computed.
        { tag: 'tfoot[data-lh-totals]', ignore: true },
        { tag: 'table > caption', ignore: true },
      ]
    },

    renderHTML({ node, HTMLAttributes }) {
      const spec = this.parent?.({ node, HTMLAttributes }) as unknown as any[]
      if (!Array.isArray(spec) || spec[0] !== 'table') return spec as unknown as DOMOutputSpec
      const caption = typeof node.attrs.caption === 'string' ? node.attrs.caption.trim() : ''
      const totals = computeTotals(readTableModel(node as any), node.attrs.totals)
      if (!caption && !totals) return spec as unknown as DOMOutputSpec
      const out = [...spec]
      if (caption) out.splice(2, 0, ['caption', {}, caption])
      if (totals) {
        const L = labels()
        out.push([
          'tfoot',
          { 'data-lh-totals': '', class: 'lh-table-totals' },
          [
            'tr',
            {},
            ...totals.values.map((value, col) =>
              col === totals.labelCol
                ? ['td', { class: 'lh-table-totals-label' }, node.attrs.totals === 'sum' ? L.total : L.average]
                : ['td', value != null ? { class: 'lh-table-totals-value' } : {}, value ?? ''],
            ),
          ],
        ])
      }
      return out as unknown as DOMOutputSpec
    },

    addNodeView() {
      const options = this.options
      const render = ({ node, view, HTMLAttributes }: any) =>
        new PlusTableView(node, options.cellMinWidth, view, mergeAttributes(options.HTMLAttributes, HTMLAttributes), {
          learner,
          labels: labels(),
        })
      // The static renderer reads `.component` (see core/nodeView.ts).
      return Object.assign(render, { component: StaticTable }) as any
    },
  }).configure({ resizable: mode !== 'preview' })

  const typedCell = <T extends typeof TableCell | typeof TableHeader>(base: T) =>
    base.extend({
      addAttributes() {
        return { ...this.parent?.(), ...CELL_EXTRA_ATTRS }
      },
      renderHTML({ node, HTMLAttributes }) {
        const spec = this.parent?.({ node, HTMLAttributes }) as unknown as any[]
        const typed = typedCellAttrs(node.attrs, node.textContent)
        if (!Array.isArray(spec) || !Object.keys(typed).length) return spec as unknown as DOMOutputSpec
        return [spec[0], mergeAttributes(spec[1] ?? {}, typed), 0] as DOMOutputSpec
      },
    })

  return [PlusTable, TableRow, typedCell(TableHeader), typedCell(TableCell)]
}
