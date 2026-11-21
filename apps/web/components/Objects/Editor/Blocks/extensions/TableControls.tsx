'use client'
/*
 Easier table editing: while the caret is in a table, a compact bar floats
 above it. The common actions are one click (merge/split, delete table); the
 rest sit in small popovers: rows and columns, headers, cell style, cell type
 (for the selected cells or the whole column) and table settings. Editor
 only; learners never get it.
*/
import React from 'react'
import { createRoot, Root } from 'react-dom/client'
import { Extension, Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import {
  RowsPlusTop, RowsPlusBottom, ColumnsPlusLeft, ColumnsPlusRight, Rows, Columns, Trash, TextHOne, CopySimple,
  ArrowsOutLineHorizontal, SquareSplitHorizontal, Palette, Hash, Sliders, TextT, ChartBarHorizontal, CheckSquare,
  Star, Tag, Calendar, TextAlignLeft, TextAlignCenter, TextAlignRight, AlignTop, AlignCenterVertical, AlignBottom,
} from '@phosphor-icons/react'
import i18n from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Switch } from '@components/ui/switch'
import { BlockToolbarButton, BlockToolbarDivider, BlockPopover, Segmented, SettingsField, CommitInput } from '../ui/BlockChrome'
import {
  CELL_COLORS, CELL_TYPES, NUMBER_FORMATS, TABLE_TOTALS, TABLE_VARIANTS, cellTypeOf,
  currentCellAttrs, distributeColumns, duplicateRow, findTable, hasHeaderColumn, hasHeaderRow, setCellType, setCellsAttrs,
  setTableAttrs, toggleHeaderColumn, toggleHeaderRow, type CellScope,
} from '../../Extensions/Plus/tables'

const key = new PluginKey('lhTableControls')

const SWATCH: Record<string, string> = {
  gray: '#a3a3a3', red: '#ef4444', orange: '#f97316', amber: '#f59e0b', green: '#22c55e',
  teal: '#14b8a6', blue: '#3b82f6', purple: '#8b5cf6', pink: '#ec4899',
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  text: <TextT size={15} />,
  progress: <ChartBarHorizontal size={15} className="rtl:-scale-x-100" />,
  checkbox: <CheckSquare size={15} />,
  rating: <Star size={15} />,
  status: <Tag size={15} className="rtl:-scale-x-100" />,
  number: <Hash size={15} />,
  date: <Calendar size={15} />,
}

interface BarProps {
  editor: Editor
  onPopover: (_open: boolean) => void
}

function Swatches({ value, onChange, noneLabel, autoLabel }: { value: string | null; onChange: (_v: string | null) => void; noneLabel?: string; autoLabel?: string }) {
  const t = i18n.t.bind(i18n)
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        aria-label={noneLabel ?? autoLabel}
        title={noneLabel ?? autoLabel}
        aria-pressed={!value}
        onClick={() => onChange(null)}
        className={cn('flex h-6 min-w-6 items-center justify-center rounded-md px-1 text-[10px] font-semibold text-neutral-500 ring-1 ring-inset ring-neutral-200 hover:bg-neutral-50', !value && 'ring-2 ring-neutral-900')}
      >
        {autoLabel ? 'A' : '∅'}
      </button>
      {CELL_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={t(`editor.blocks_v2.colors.${c}`, c)}
          title={t(`editor.blocks_v2.colors.${c}`, c)}
          aria-pressed={value === c}
          onClick={() => onChange(c)}
          className={cn('h-6 w-6 rounded-md ring-offset-1 outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50', value === c && 'ring-2 ring-neutral-900')}
          style={{ background: SWATCH[c] }}
        />
      ))}
    </div>
  )
}

function MenuButton({ icon, label, onClick, danger, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-lg px-2 text-start text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sky-500/40 disabled:opacity-40',
        danger ? 'text-neutral-600 hover:bg-rose-50 hover:text-rose-600' : 'text-neutral-700 hover:bg-neutral-100',
      )}
    >
      <span className="flex w-4 justify-center text-neutral-500">{icon}</span>
      {label}
    </button>
  )
}

function SwitchRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (_v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-[13px] text-neutral-700">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </label>
  )
}

function TableBar({ editor, onPopover }: BarProps) {
  const t = (k: string, fallback: string) => String(i18n.t(k, fallback))
  const tt = (k: string, fallback: string) => t(`editor.blocks_v2.table.${k}`, fallback)
  const [open, setOpen] = React.useState<string | null>(null)
  const [scope, setScope] = React.useState<CellScope>('selection')
  const state = editor.state
  const table = findTable(state)
  const tableAttrs = table?.node.attrs ?? {}
  const cell = currentCellAttrs(state) ?? {}
  const cellType = cellTypeOf(cell)
  const chain = () => editor.chain()

  const popover = (id: string, label: string, icon: React.ReactNode, content: React.ReactNode, width = 288) => (
    <BlockPopover
      open={open === id}
      onOpenChange={(o) => {
        setOpen(o ? id : null)
        onPopover(o)
      }}
      title={label}
      width={width}
      align="start"
      trigger={
        <BlockToolbarButton label={label} active={open === id} aria-haspopup="dialog">
          {icon}
        </BlockToolbarButton>
      }
    >
      {content}
    </BlockPopover>
  )

  const scopeField = (
    <SettingsField label={tt('apply_to', 'Apply to')}>
      <Segmented
        ariaLabel={tt('apply_to', 'Apply to')}
        value={scope}
        onChange={setScope}
        options={[
          { value: 'selection', label: tt('scope_selection', 'Selected cells') },
          { value: 'column', label: tt('scope_column', 'Whole column') },
        ]}
      />
    </SettingsField>
  )

  const typed = cellType !== 'text'
  const toneable = cellType === 'status' || cellType === 'progress' || cellType === 'checkbox' || cellType === 'rating'

  return (
    <div
      role="toolbar"
      aria-label={t('editor.blocks_v2.table_tools', 'Table')}
      className="flex items-center gap-0.5 rounded-[10px] bg-white p-0.5 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.08)]"
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest('input,textarea,select')) e.preventDefault()
      }}
    >
      {popover(
        'rows',
        tt('rows_cols', 'Rows and columns'),
        <RowsPlusBottom size={15} />,
        <div className="-m-1 flex flex-col">
          <MenuButton icon={<RowsPlusTop size={15} />} label={t('editor.blocks_v2.row_above', 'Insert row above')} onClick={() => chain().addRowBefore().run()} />
          <MenuButton icon={<RowsPlusBottom size={15} />} label={t('editor.blocks_v2.row_below', 'Insert row below')} onClick={() => chain().addRowAfter().run()} />
          <MenuButton icon={<CopySimple size={15} />} label={tt('duplicate_row', 'Duplicate row')} onClick={() => duplicateRow(editor)} />
          <MenuButton icon={<ColumnsPlusLeft size={15} className="rtl:-scale-x-100" />} label={t('editor.blocks_v2.col_before', 'Insert column before')} onClick={() => chain().addColumnBefore().run()} />
          <MenuButton icon={<ColumnsPlusRight size={15} className="rtl:-scale-x-100" />} label={t('editor.blocks_v2.col_after', 'Insert column after')} onClick={() => chain().addColumnAfter().run()} />
          <MenuButton icon={<ArrowsOutLineHorizontal size={15} />} label={tt('distribute', 'Distribute columns evenly')} onClick={() => distributeColumns(editor)} />
          <div className="my-1 h-px bg-neutral-100" />
          <MenuButton icon={<Rows size={15} />} danger label={t('editor.toolbar.delete_row', 'Delete row')} onClick={() => chain().deleteRow().run()} />
          <MenuButton icon={<Columns size={15} />} danger label={t('editor.toolbar.delete_column', 'Delete column')} onClick={() => chain().deleteColumn().run()} />
        </div>,
        240,
      )}
      <BlockToolbarButton label={tt('merge_split', 'Merge or split cells')} disabled={!editor.can().mergeOrSplit()} className="disabled:opacity-40" onClick={() => chain().mergeOrSplit().run()}>
        <SquareSplitHorizontal size={15} />
      </BlockToolbarButton>
      {popover(
        'headers',
        tt('headers', 'Headers'),
        <TextHOne size={15} />,
        <div className="flex flex-col gap-2.5">
          <SwitchRow label={t('editor.blocks_v2.header_row', 'Header row')} checked={hasHeaderRow(state)} onChange={() => toggleHeaderRow(editor)} />
          <SwitchRow label={tt('header_column', 'Header column')} checked={hasHeaderColumn(state)} onChange={() => toggleHeaderColumn(editor)} />
        </div>,
        240,
      )}
      <BlockToolbarDivider />
      {popover(
        'cell',
        tt('cell_style', 'Cell style'),
        <Palette size={15} />,
        <>
          {scopeField}
          <SettingsField label={tt('background', 'Background')}>
            <Swatches value={cell.background ?? null} noneLabel={t('editor.blocks_v2.default_color', 'Default')} onChange={(background) => setCellsAttrs(editor, { background }, scope)} />
          </SettingsField>
          <SettingsField label={tt('align', 'Alignment')}>
            <Segmented
              ariaLabel={tt('align', 'Alignment')}
              value={cell.align === 'left' ? 'start' : cell.align === 'right' ? 'end' : (cell.align ?? 'start')}
              onChange={(align) => setCellsAttrs(editor, { align: align === 'start' ? null : align }, scope)}
              options={[
                { value: 'start', title: tt('align_start', 'Start'), label: <TextAlignLeft size={15} className="rtl:-scale-x-100" /> },
                { value: 'center', title: tt('align_center', 'Center'), label: <TextAlignCenter size={15} /> },
                { value: 'end', title: tt('align_end', 'End'), label: <TextAlignRight size={15} className="rtl:-scale-x-100" /> },
              ]}
            />
          </SettingsField>
          <SettingsField label={tt('valign', 'Vertical alignment')}>
            <Segmented
              ariaLabel={tt('valign', 'Vertical alignment')}
              value={cell.valign ?? 'top'}
              onChange={(valign) => setCellsAttrs(editor, { valign: valign === 'top' ? null : valign }, scope)}
              options={[
                { value: 'top', title: tt('valign_top', 'Top'), label: <AlignTop size={15} /> },
                { value: 'middle', title: tt('valign_middle', 'Middle'), label: <AlignCenterVertical size={15} /> },
                { value: 'bottom', title: tt('valign_bottom', 'Bottom'), label: <AlignBottom size={15} /> },
              ]}
            />
          </SettingsField>
        </>,
      )}
      {popover(
        'type',
        tt('cell_type', 'Cell type'),
        TYPE_ICON[cellType] ?? <Hash size={15} />,
        <>
          {scopeField}
          <SettingsField label={tt('cell_type', 'Cell type')} hint={typed ? tt('type_hint', 'The value stays in the cell text, e.g. 75, 4/5 or yes.') : undefined}>
            <div role="radiogroup" aria-label={tt('cell_type', 'Cell type')} className="grid grid-cols-4 gap-1">
              {CELL_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={cellType === type}
                  onClick={() => setCellType(editor, type, scope)}
                  className={cn(
                    'flex h-12 flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sky-500/40',
                    cellType === type ? 'bg-neutral-900 text-white' : 'bg-neutral-50 text-neutral-600 hover:bg-neutral-100',
                  )}
                >
                  {TYPE_ICON[type]}
                  <span className="max-w-full truncate px-0.5">{tt(`type.${type}`, type)}</span>
                </button>
              ))}
            </div>
          </SettingsField>
          {toneable && (
            <SettingsField label={tt('tone', 'Colour')}>
              <Swatches value={cell.tone ?? null} autoLabel={tt('tone_auto', 'Automatic')} onChange={(tone) => setCellsAttrs(editor, { tone }, scope, { skipHeaders: true })} />
            </SettingsField>
          )}
          {cellType === 'number' && (
            <>
              <SettingsField label={tt('number_format', 'Number format')}>
                <Segmented
                  ariaLabel={tt('number_format', 'Number format')}
                  value={cell.numberFormat ?? 'plain'}
                  onChange={(numberFormat) => setCellsAttrs(editor, { numberFormat: numberFormat === 'plain' ? null : numberFormat }, scope, { skipHeaders: true })}
                  options={NUMBER_FORMATS.map((f) => ({ value: f, label: tt(`format.${f}`, f) }))}
                />
              </SettingsField>
              {cell.numberFormat === 'currency' && (
                <SettingsField label={tt('currency', 'Currency code')}>
                  <CommitInput
                    value={cell.currency ?? ''}
                    placeholder="USD"
                    maxLength={3}
                    aria-label={tt('currency', 'Currency code')}
                    onCommit={(v) => setCellsAttrs(editor, { currency: v.trim().toUpperCase() || null }, scope, { skipHeaders: true })}
                  />
                </SettingsField>
              )}
            </>
          )}
        </>,
        304,
      )}
      {popover(
        'table',
        tt('settings', 'Table settings'),
        <Sliders size={15} />,
        <>
          <SettingsField label={tt('variant', 'Style')} hint={tableAttrs.variant === 'cards' ? tt('cards_hint', 'Rows become cards on phones.') : undefined}>
            <div role="radiogroup" aria-label={tt('variant', 'Style')} className="grid grid-cols-3 gap-1">
              {TABLE_VARIANTS.map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={(tableAttrs.variant ?? 'default') === v}
                  onClick={() => setTableAttrs(editor, { variant: v })}
                  className={cn(
                    'h-7 rounded-md px-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sky-500/40',
                    (tableAttrs.variant ?? 'default') === v ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600 hover:text-neutral-900',
                  )}
                >
                  {tt(`variants.${v}`, v)}
                </button>
              ))}
            </div>
          </SettingsField>
          <SettingsField label={tt('caption', 'Caption')}>
            <CommitInput
              value={tableAttrs.caption ?? ''}
              placeholder={tt('caption_placeholder', 'Describe the table')}
              aria-label={tt('caption', 'Caption')}
              onCommit={(v) => setTableAttrs(editor, { caption: v.trim() || null })}
            />
          </SettingsField>
          <div className="flex flex-col gap-2.5">
            <SwitchRow label={tt('sortable', 'Learners can sort')} checked={!!tableAttrs.sortable} onChange={(sortable) => setTableAttrs(editor, { sortable })} />
            <SwitchRow label={tt('sticky_header', 'Sticky header')} checked={!!tableAttrs.stickyHeader} onChange={(stickyHeader) => setTableAttrs(editor, { stickyHeader })} />
            <SwitchRow label={tt('compact', 'Compact rows')} checked={!!tableAttrs.compact} onChange={(compact) => setTableAttrs(editor, { compact })} />
          </div>
          <SettingsField label={tt('totals', 'Totals row')} hint={tt('totals_hint', 'For number and progress columns.')}>
            <Segmented
              ariaLabel={tt('totals', 'Totals row')}
              value={tableAttrs.totals ?? 'none'}
              onChange={(totals) => setTableAttrs(editor, { totals })}
              options={TABLE_TOTALS.map((v) => ({ value: v, label: tt(`totals_${v}`, v) }))}
            />
          </SettingsField>
        </>,
        300,
      )}
      <BlockToolbarDivider />
      <BlockToolbarButton label={t('editor.blocks_v2.delete_table', 'Delete table')} tone="danger" onClick={() => chain().focus().deleteTable().run()}>
        <Trash size={15} />
      </BlockToolbarButton>
    </div>
  )
}

export const TableControls = Extension.create({
  name: 'lhTableControls',

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key,
        view(view) {
          const host = document.createElement('div')
          Object.assign(host.style, { position: 'fixed', zIndex: '150', display: 'none' })
          document.body.appendChild(host)
          let root: Root | null = createRoot(host)
          let rafId = 0
          let mounted = false
          // A popover of the bar is open: keep the bar (and its anchor) while
          // focus is in the popover rather than in the editor.
          let popoverOpen = false

          const findTableDom = (): HTMLElement | null => {
            const { $from } = view.state.selection
            for (let d = $from.depth; d > 0; d--) {
              if ($from.node(d).type.name === 'table') {
                const dom = view.nodeDOM($from.before(d)) as HTMLElement | null
                return (dom?.closest?.('.tableWrapper') as HTMLElement) || dom
              }
            }
            return null
          }

          const onPopover = (open: boolean) => {
            popoverOpen = open
            if (!open) {
              // Back to the table after Escape or picking an option, unless the
              // click that closed the popover went somewhere else.
              setTimeout(() => {
                const active = document.activeElement
                if (!active || active === document.body || host.contains(active)) editor.commands.focus()
                update()
              }, 0)
            }
          }

          const update = () => {
            cancelAnimationFrame(rafId)
            rafId = requestAnimationFrame(() => {
              const inEditor = !!view.dom.closest('.activity-editor-content-wrapper')
              const keep = popoverOpen || host.contains(document.activeElement)
              const table = inEditor && view.editable && (view.hasFocus() || keep) ? findTableDom() : null
              if (!table) {
                host.style.display = 'none'
                if (mounted) {
                  root?.render(<></>)
                  mounted = false
                  popoverOpen = false
                }
                return
              }
              root?.render(<TableBar editor={editor} onPopover={onPopover} />)
              mounted = true
              const rect = table.getBoundingClientRect()
              host.style.display = 'block'
              host.style.top = `${Math.max(8, rect.top - 40)}px`
              host.style.left = `${Math.max(8, rect.left)}px`
            })
          }
          const onScroll = () => update()
          window.addEventListener('scroll', onScroll, true)
          // Focus moving into the bar would hide it; keep it while hovered.
          const onBlur = () => setTimeout(update, 120)
          view.dom.addEventListener('blur', onBlur)
          view.dom.addEventListener('focus', update)
          update()
          return {
            update,
            destroy() {
              cancelAnimationFrame(rafId)
              window.removeEventListener('scroll', onScroll, true)
              view.dom.removeEventListener('blur', onBlur)
              view.dom.removeEventListener('focus', update)
              const r = root
              root = null
              setTimeout(() => {
                r?.unmount()
                host.remove()
              }, 0)
            },
          }
        },
      }),
    ]
  },
})

export default TableControls
