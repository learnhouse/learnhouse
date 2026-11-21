// Tables (owner: tables builder). See EDITOR_PLUS_SPEC.md, section A.
// The stock table nodes extended in place (same names, optional attrs whose
// defaults render exactly as before), typed cells, learner sorting/totals,
// the editor's typed-cell decorations and TSV/CSV paste, and slash templates.
import i18n from '@/lib/i18n'
import type { PlusExtensionFactory } from '../types'
import { createTableNodes } from './tableNodes'
import { createTableEditing } from './tablePlugins'
import type { TableViewLabels } from './tableView'
import './tables.css'

const a = (key: string, fallback: string, opts: Record<string, unknown> = {}) => String(i18n.t(`activities.table.${key}`, fallback, opts))

export const tableLabels = (): TableViewLabels => ({
  total: a('total', 'Total'),
  average: a('average', 'Average'),
  sortBy: a('sort_by', 'Sort by'),
  originalOrder: a('original_order', 'Original order'),
  ascending: a('ascending', 'Ascending'),
  descending: a('descending', 'Descending'),
  sortDirection: a('sort_direction', 'Sort direction'),
  sorted: (column, direction) => a('sorted', 'Sorted by {{column}}, {{direction}}', { column, direction }),
  column: (n) => a('column_n', 'Column {{n}}', { n }),
})

export const tableExtensions: PlusExtensionFactory = ({ mode }) => [
  ...createTableNodes({ mode, labels: tableLabels }),
  ...(mode === 'editor'
    ? [createTableEditing({ toggleLabel: () => String(i18n.t('editor.blocks_v2.table.toggle_checkbox', 'Toggle checkbox')) })]
    : []),
]

// Slash templates: ./templates (editor only, gathered in ../slashItems).

export * from './tableCommands'
export { CELL_TYPES, CELL_COLORS, TABLE_VARIANTS, TABLE_TOTALS, NUMBER_FORMATS, cellTypeOf } from './tableAttrs'
