/*
 The table's node view in the editor and in DynamicCanva (the learner canvas
 built on an editor). It is the stock TableView (wrapper, colgroup, tbody,
 column resizing) plus what lives outside the cells: the caption, the totals
 footer, the learner sort bar and the per-table card labels.

 Everything added sits outside the contentDOM, so the stock ignoreMutation
 keeps ProseMirror from reading it. Sorting (learners only) moves the row
 elements, and those moves are ignored too: the document never changes.
*/
import { TableView } from '@tiptap/extension-table'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorView, ViewMutationRecord } from '@tiptap/pm/view'
import { cardLabelsCss, computeTotals, readTableModel, sortRowOrder, type SortDir, type TableModel } from './tableModel'

export interface TableViewLabels {
  total: string
  average: string
  sortBy: string
  originalOrder: string
  ascending: string
  descending: string
  sortDirection: string
  sorted: (_column: string, _direction: string) => string
  column: (_n: number) => string
}

export const DEFAULT_TABLE_LABELS: TableViewLabels = {
  total: 'Total',
  average: 'Average',
  sortBy: 'Sort by',
  originalOrder: 'Original order',
  ascending: 'Ascending',
  descending: 'Descending',
  sortDirection: 'Sort direction',
  sorted: (column, direction) => `Sorted by ${column}, ${direction}`,
  column: (n) => `Column ${n}`,
}

let uid = 0
export const nextTableId = () => `lh-table-${++uid}`

export function wrapperClassNames(attrs: Record<string, any>): string[] {
  const out: string[] = []
  if (attrs.stickyHeader) out.push('lh-table-sticky')
  if (attrs.variant && attrs.variant !== 'default') out.push(`lh-table-${attrs.variant}`)
  return out
}

export class PlusTableView extends TableView {
  learner: boolean
  labels: TableViewLabels
  id = nextTableId()
  model: TableModel
  caption: HTMLElement | null = null
  tfoot: HTMLTableSectionElement | null = null
  sortBar: HTMLElement | null = null
  live: HTMLElement | null = null
  cardStyle: HTMLStyleElement | null = null
  sort: { col: number; dir: SortDir } | null = null
  /** Row elements in document order, captured before the first move. */
  originalRows: HTMLElement[] | null = null

  constructor(
    node: PMNode,
    cellMinWidth: number,
    view: EditorView | undefined,
    HTMLAttributes: Record<string, any>,
    opts: { learner: boolean; labels: TableViewLabels },
  ) {
    super(node, cellMinWidth, view, HTMLAttributes)
    this.learner = opts.learner
    this.labels = opts.labels
    this.model = readTableModel(node as any)
    this.table.id = this.id
    this.dom.classList.add(...wrapperClassNames(node.attrs))
    this.renderExtras()
    if (this.learner) this.table.addEventListener('click', this.onHeaderClick)
  }

  update(node: PMNode) {
    if (this.sort) {
      // Hand ProseMirror its rows back in document order before it
      // reconciles them; the sort is dropped (the rows may have changed).
      this.sort = null
      this.applySort()
    }
    this.originalRows = null
    if (!super.update(node)) return false
    this.model = readTableModel(node as any)
    this.renderExtras()
    return true
  }

  ignoreMutation(mutation: ViewMutationRecord) {
    // Row moves made by sorting (learners only; the document is read-only).
    if (this.learner && mutation.type === 'childList' && mutation.target === this.contentDOM) return true
    return super.ignoreMutation(mutation)
  }

  /** The sort bar's select and button handle their own events. */
  stopEvent(event: Event) {
    return !!this.sortBar && this.sortBar.contains(event.target as Node)
  }

  destroy() {
    this.table.removeEventListener('click', this.onHeaderClick)
  }

  private renderExtras() {
    const attrs = this.node.attrs
    // Caption: a block above the table (a <caption> would sit before the
    // colgroup, which column resizing expects to be the table's first child).
    const captionText = typeof attrs.caption === 'string' ? attrs.caption.trim() : ''
    if (captionText) {
      if (!this.caption) {
        this.caption = document.createElement('div')
        this.caption.className = 'lh-table-caption'
        this.caption.id = `${this.id}-caption`
        this.caption.contentEditable = 'false'
        this.dom.insertBefore(this.caption, this.table)
      }
      this.caption.textContent = captionText
      this.table.setAttribute('aria-labelledby', this.caption.id)
    } else if (this.caption) {
      this.caption.remove()
      this.caption = null
      this.table.removeAttribute('aria-labelledby')
    }

    this.renderTotals()
    if (this.learner) this.renderSortBar()

    const css = attrs.variant === 'cards' ? cardLabelsCss(this.id, this.model) : ''
    if (css) {
      if (!this.cardStyle) {
        this.cardStyle = document.createElement('style')
        this.dom.appendChild(this.cardStyle)
      }
      if (this.cardStyle.textContent !== css) this.cardStyle.textContent = css
    } else if (this.cardStyle) {
      this.cardStyle.remove()
      this.cardStyle = null
    }
  }

  private renderTotals() {
    const totals = computeTotals(this.model, this.node.attrs.totals)
    if (!totals) {
      this.tfoot?.remove()
      this.tfoot = null
      return
    }
    if (!this.tfoot) {
      this.tfoot = document.createElement('tfoot')
      this.tfoot.className = 'lh-table-totals'
      this.tfoot.contentEditable = 'false'
      this.table.appendChild(this.tfoot)
    }
    const tr = document.createElement('tr')
    totals.values.forEach((value, col) => {
      const td = document.createElement('td')
      if (col === totals.labelCol) {
        td.textContent = this.node.attrs.totals === 'sum' ? this.labels.total : this.labels.average
        td.className = 'lh-table-totals-label'
      } else if (value != null) {
        td.textContent = value
        td.className = 'lh-table-totals-value'
      }
      tr.appendChild(td)
    })
    this.tfoot.replaceChildren(tr)
  }

  private renderSortBar() {
    const enabled = !!this.node.attrs.sortable && this.model.canSort && this.model.rows.length - this.model.headerRows > 1
    this.table.toggleAttribute('data-lh-sortable-live', enabled)
    if (!enabled) {
      this.sortBar?.remove()
      this.sortBar = null
      this.live?.remove()
      this.live = null
      if (this.sort) {
        this.sort = null
        this.applySort()
      }
      return
    }
    const L = this.labels
    if (!this.sortBar) {
      const bar = document.createElement('div')
      bar.className = 'lh-table-sortbar'
      bar.contentEditable = 'false'
      const label = document.createElement('label')
      const span = document.createElement('span')
      span.textContent = L.sortBy
      const select = document.createElement('select')
      select.addEventListener('change', () => {
        const col = parseInt(select.value, 10)
        this.setSort(Number.isNaN(col) ? null : { col, dir: this.sort?.dir ?? 'asc' })
      })
      label.append(span, select)
      const dir = document.createElement('button')
      dir.type = 'button'
      dir.className = 'lh-table-sortdir'
      dir.addEventListener('click', () => {
        if (this.sort) this.setSort({ col: this.sort.col, dir: this.sort.dir === 'asc' ? 'desc' : 'asc' })
      })
      bar.append(label, dir)
      this.dom.insertBefore(bar, this.table)
      this.sortBar = bar
      this.live = document.createElement('div')
      this.live.className = 'sr-only'
      this.live.setAttribute('aria-live', 'polite')
      this.dom.appendChild(this.live)
    }
    const select = this.sortBar.querySelector('select')!
    const labels = [L.originalOrder, ...this.model.columnLabels.map((label, i) => label || L.column(i + 1))]
    const signature = JSON.stringify(labels)
    if (select.dataset.options !== signature) {
      select.replaceChildren(
        ...labels.map((text, i) => {
          const option = document.createElement('option')
          option.value = i === 0 ? '' : String(i - 1)
          option.textContent = text
          return option
        }),
      )
      select.dataset.options = signature
    }
    select.value = this.sort ? String(this.sort.col) : ''
    this.renderSortState()
  }

  private renderSortState() {
    const dir = this.sortBar?.querySelector<HTMLButtonElement>('.lh-table-sortdir')
    if (dir) {
      const d = this.sort?.dir ?? 'asc'
      dir.disabled = !this.sort
      dir.dataset.dir = d
      dir.setAttribute('aria-label', `${this.labels.sortDirection}: ${d === 'asc' ? this.labels.ascending : this.labels.descending}`)
      dir.title = dir.getAttribute('aria-label')!
      dir.textContent = d === 'asc' ? '↑' : '↓'
    }
    if (this.sort) {
      this.table.setAttribute('data-lh-sort-col', String(this.sort.col + 1))
      this.table.setAttribute('data-lh-sort-dir', this.sort.dir)
    } else {
      this.table.removeAttribute('data-lh-sort-col')
      this.table.removeAttribute('data-lh-sort-dir')
    }
  }

  setSort(sort: { col: number; dir: SortDir } | null) {
    this.sort = sort
    this.applySort()
    const select = this.sortBar?.querySelector('select')
    if (select) select.value = sort ? String(sort.col) : ''
    this.renderSortState()
    if (this.live) {
      this.live.textContent = sort
        ? this.labels.sorted(this.model.columnLabels[sort.col] || this.labels.column(sort.col + 1), sort.dir === 'asc' ? this.labels.ascending : this.labels.descending)
        : this.labels.originalOrder
    }
  }

  private applySort() {
    if (!this.originalRows) {
      if (!this.sort) return
      // Rows are only ever moved, never recreated, so tagging is not needed:
      // the first sort records the document order.
      this.originalRows = Array.from(this.contentDOM.children) as HTMLElement[]
    }
    const rows = this.originalRows
    if (rows.length !== this.model.rows.length) return
    const order = this.sort ? sortRowOrder(this.model, this.sort.col, this.sort.dir) : rows.map((_, i) => i)
    order.forEach((index) => {
      const row = rows[index]
      if (row) this.contentDOM.appendChild(row)
    })
  }

  private onHeaderClick = (event: MouseEvent) => {
    if (!this.sortBar) return
    const th = (event.target as HTMLElement)?.closest?.('th')
    const row = th?.parentElement
    if (!th || !row || row.parentElement !== this.contentDOM) return
    const rowIndex = (this.originalRows ?? Array.from(this.contentDOM.children)).indexOf(row)
    if (rowIndex !== this.model.headerRows - 1) return
    let col = 0
    for (let el = th.previousElementSibling; el; el = el.previousElementSibling) col += Number((el as HTMLTableCellElement).colSpan) || 1
    const dir: SortDir = this.sort?.col === col && this.sort.dir === 'asc' ? 'desc' : 'asc'
    this.setSort({ col, dir })
  }
}
