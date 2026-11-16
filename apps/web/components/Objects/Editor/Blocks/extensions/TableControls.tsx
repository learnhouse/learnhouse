'use client'
/*
 Easier table editing: while the caret is in a table, a compact bar floats
 above it with insert/delete row and column, header row toggle and delete
 table. Editor only; learners never get it.
*/
import React from 'react'
import { createRoot, Root } from 'react-dom/client'
import { Extension, Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import {
  RowsPlusTop, RowsPlusBottom, ColumnsPlusLeft, ColumnsPlusRight, Rows, Columns, Trash, TextHOne,
} from '@phosphor-icons/react'
import i18n from '@/lib/i18n'
import { BlockToolbarButton, BlockToolbarDivider } from '../ui/BlockChrome'

const key = new PluginKey('lhTableControls')

function TableBar({ editor }: { editor: Editor }) {
  const t = i18n.t.bind(i18n)
  const run = (fn: (_chain: any) => any) => () => fn(editor.chain().focus()).run()
  return (
    <div
      role="toolbar"
      aria-label={t('editor.blocks_v2.table_tools', 'Table')}
      className="flex items-center gap-0.5 rounded-[10px] bg-white p-0.5 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.08)]"
      onMouseDown={(e) => e.preventDefault()}
    >
      <BlockToolbarButton label={t('editor.blocks_v2.row_above', 'Insert row above')} onClick={run((c) => c.addRowBefore())}>
        <RowsPlusTop size={15} />
      </BlockToolbarButton>
      <BlockToolbarButton label={t('editor.blocks_v2.row_below', 'Insert row below')} onClick={run((c) => c.addRowAfter())}>
        <RowsPlusBottom size={15} />
      </BlockToolbarButton>
      <BlockToolbarButton label={t('editor.blocks_v2.col_before', 'Insert column before')} onClick={run((c) => c.addColumnBefore())}>
        <ColumnsPlusLeft size={15} className="rtl:-scale-x-100" />
      </BlockToolbarButton>
      <BlockToolbarButton label={t('editor.blocks_v2.col_after', 'Insert column after')} onClick={run((c) => c.addColumnAfter())}>
        <ColumnsPlusRight size={15} className="rtl:-scale-x-100" />
      </BlockToolbarButton>
      <BlockToolbarDivider />
      <BlockToolbarButton
        label={t('editor.blocks_v2.header_row', 'Header row')}
        active={(() => {
          const { $from } = editor.state.selection
          for (let d = $from.depth; d > 0; d--) {
            const n = $from.node(d)
            if (n.type.name === 'table') return n.firstChild?.firstChild?.type.name === 'tableHeader'
          }
          return false
        })()}
        onClick={run((c) => c.toggleHeaderRow())}
      >
        <TextHOne size={15} />
      </BlockToolbarButton>
      <BlockToolbarDivider />
      <BlockToolbarButton label={t('editor.toolbar.delete_row', 'Delete row')} tone="danger" onClick={run((c) => c.deleteRow())}>
        <Rows size={15} />
      </BlockToolbarButton>
      <BlockToolbarButton label={t('editor.toolbar.delete_column', 'Delete column')} tone="danger" onClick={run((c) => c.deleteColumn())}>
        <Columns size={15} />
      </BlockToolbarButton>
      <BlockToolbarButton label={t('editor.blocks_v2.delete_table', 'Delete table')} tone="danger" onClick={run((c) => c.deleteTable())}>
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

          const update = () => {
            cancelAnimationFrame(rafId)
            rafId = requestAnimationFrame(() => {
              const inEditor = !!view.dom.closest('.activity-editor-content-wrapper')
              const table = inEditor && view.editable && view.hasFocus() ? findTableDom() : null
              if (!table) {
                host.style.display = 'none'
                return
              }
              root?.render(<TableBar editor={editor} />)
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
