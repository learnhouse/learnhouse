'use client'
/*
 The table as the static renderer draws it (StaticCanva, the embed and
 @learnhouse/react). Same DOM as PlusTableView in DynamicCanva: the wrapper,
 caption, sort bar, colgroup, rows (the cells come from the schema's
 renderHTML, typed visuals included) and the totals footer. Sorting reorders
 the rendered rows in React state; the document is never touched.
*/
import React, { useId, useMemo, useState } from 'react'
import { useReactNodeView } from '@tiptap/react'
import type { Node as PMNode } from '@tiptap/pm/model'
import { tableDataAttrs } from './tableAttrs'
import { cardLabelsCss, computeTotals, readTableModel, sortHeaderCss, sortRowOrder, type SortDir } from './tableModel'
import { wrapperClassNames, type TableViewLabels } from './tableView'

const CELL_MIN_WIDTH = 25

/** The stock colgroup and table width (same numbers as TableView). */
function columnsOf(node: PMNode) {
  const cols: (number | null)[] = []
  const row = node.firstChild
  let total = 0
  let fixed = true
  if (row) {
    for (let i = 0; i < row.childCount; i++) {
      const { colspan, colwidth } = row.child(i).attrs
      for (let j = 0; j < (colspan || 1); j++) {
        const w = colwidth && colwidth[j]
        cols.push(w ? Math.max(w, CELL_MIN_WIDTH) : null)
        total += w || CELL_MIN_WIDTH
        if (!w) fixed = false
      }
    }
  }
  return { cols, style: fixed ? { width: `${total}px` } : { minWidth: `${total}px` } }
}

export function makeStaticTable(getLabels: () => TableViewLabels) {
  return function StaticTable({ node }: { node: PMNode }) {
    const { nodeViewContentChildren } = useReactNodeView()
    const labels = getLabels()
    const reactId = useId()
    const id = `lh-table-${reactId.replace(/[^\w-]/g, '')}`
    const model = useMemo(() => readTableModel(node as any), [node])
    const [sort, setSort] = useState<{ col: number; dir: SortDir } | null>(null)
    const attrs = node.attrs
    const { cols, style } = useMemo(() => columnsOf(node), [node])

    const rows = React.Children.toArray(nodeViewContentChildren as React.ReactNode)
    const canSort = !!attrs.sortable && model.canSort && model.rows.length - model.headerRows > 1 && rows.length === model.rows.length
    const order = canSort && sort ? sortRowOrder(model, sort.col, sort.dir) : rows.map((_, i) => i)
    const totals = computeTotals(model, attrs.totals)
    const caption = typeof attrs.caption === 'string' ? attrs.caption.trim() : ''
    const css = (attrs.variant === 'cards' ? cardLabelsCss(id, model) : '') + (canSort && sort ? sortHeaderCss(id, sort.col, sort.dir) : '')
    const columnName = (col: number) => model.columnLabels[col] || labels.column(col + 1)

    const onHeaderClick = (e: React.MouseEvent) => {
      if (!canSort) return
      const th = (e.target as HTMLElement).closest?.('th')
      const tr = th?.parentElement
      if (!th || !tr || tr.parentElement?.parentElement !== e.currentTarget) return
      const visual = Array.prototype.indexOf.call(tr.parentElement!.children, tr)
      if (order[visual] !== model.headerRows - 1) return
      let col = 0
      for (let el = th.previousElementSibling; el; el = el.previousElementSibling) col += (el as HTMLTableCellElement).colSpan || 1
      setSort((s) => ({ col, dir: s?.col === col && s.dir === 'asc' ? 'desc' : 'asc' }))
    }

    return (
      <div className={['tableWrapper', ...wrapperClassNames(attrs)].join(' ')}>
        {caption && (
          <div className="lh-table-caption" id={`${id}-caption`}>
            {caption}
          </div>
        )}
        {canSort && (
          <div className="lh-table-sortbar">
            <label>
              <span>{labels.sortBy}</span>
              <select
                value={sort ? String(sort.col) : ''}
                onChange={(e) => {
                  const col = parseInt(e.target.value, 10)
                  setSort(Number.isNaN(col) ? null : { col, dir: sort?.dir ?? 'asc' })
                }}
              >
                <option value="">{labels.originalOrder}</option>
                {model.columnLabels.map((_, i) => (
                  <option key={i} value={String(i)}>
                    {columnName(i)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="lh-table-sortdir"
              disabled={!sort}
              data-dir={sort?.dir ?? 'asc'}
              aria-label={`${labels.sortDirection}: ${sort?.dir === 'desc' ? labels.descending : labels.ascending}`}
              title={`${labels.sortDirection}: ${sort?.dir === 'desc' ? labels.descending : labels.ascending}`}
              onClick={() => sort && setSort({ col: sort.col, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
            >
              {sort?.dir === 'desc' ? '↓' : '↑'}
            </button>
          </div>
        )}
        <table
          id={id}
          {...tableDataAttrs(attrs)}
          {...(canSort ? { 'data-lh-sortable-live': '' } : {})}
          {...(canSort && sort ? { 'data-lh-sort-col': String(sort.col + 1), 'data-lh-sort-dir': sort.dir } : {})}
          aria-labelledby={caption ? `${id}-caption` : undefined}
          style={style}
          onClick={canSort ? onHeaderClick : undefined}
        >
          <colgroup>
            {cols.map((w, i) => (
              <col key={i} style={w ? { width: `${w}px` } : { minWidth: `${CELL_MIN_WIDTH}px` }} />
            ))}
          </colgroup>
          <tbody>
            {order.map((index) => (
              <React.Fragment key={index}>{rows[index]}</React.Fragment>
            ))}
          </tbody>
          {totals && (
            <tfoot className="lh-table-totals">
              <tr>
                {totals.values.map((value, col) => (
                  <td key={col} className={col === totals.labelCol ? 'lh-table-totals-label' : value != null ? 'lh-table-totals-value' : undefined}>
                    {col === totals.labelCol ? (attrs.totals === 'sum' ? labels.total : labels.average) : value}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
        {canSort && (
          <div className="sr-only" aria-live="polite">
            {sort ? labels.sorted(columnName(sort.col), sort.dir === 'asc' ? labels.ascending : labels.descending) : ''}
          </div>
        )}
        {css && <style>{css}</style>}
      </div>
    )
  }
}
