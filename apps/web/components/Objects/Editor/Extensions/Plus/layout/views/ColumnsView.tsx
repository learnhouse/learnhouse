'use client'
/*
 Columns: 2–4 `column` children laid out on a CSS grid. Columns stack when
 their container gets narrow (a container query, so it also works in a narrow
 editor or an embed), unless the author turns stacking off.
*/
import React from 'react'
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { Columns as ColumnsIcon } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import EditorBlockFrame from '../../../../Blocks/ui/EditorBlockFrame'
import { BlockPopover, BlockToolbarButton, Segmented, SettingsField } from '../../../../Blocks/ui/BlockChrome'
import { cn } from '@/lib/utils'
import { COLUMN_GAPS, COLUMN_LAYOUTS, COLUMN_VALIGNS, columnTracks, effectiveLayout, oneOf, relayoutColumns, type ColumnLayout } from '../layoutModel'
import { childrenJSON, commitAttrs, liveNode, replaceChildren, SwitchRow } from '../shared'

function LayoutGlyph({ layout }: { layout: ColumnLayout }) {
  return (
    <span aria-hidden className="flex h-4 w-10 gap-0.5">
      {layout.split('-').map((n, i) => (
        <span key={i} className="rounded-[3px] bg-current opacity-70" style={{ flexGrow: Number(n), flexBasis: 0 }} />
      ))}
    </span>
  )
}

export default function ColumnsView(props: NodeViewProps) {
  const { t } = useTranslation()
  const isEditable = !!(useEditorProvider() as any)?.isEditable
  const { node } = props
  const layout = oneOf(COLUMN_LAYOUTS, node.attrs.layout, '1-1')
  const gap = oneOf(COLUMN_GAPS, node.attrs.gap, 'md')
  const valign = oneOf(COLUMN_VALIGNS, node.attrs.verticalAlign, 'top')
  const stack = node.attrs.stackOnMobile !== false
  const [open, setOpen] = React.useState(false)

  const setLayout = (next: ColumnLayout) => {
    const live = liveNode(props)
    if (!live || live.node.attrs.layout === next) return
    replaceChildren(props, relayoutColumns(childrenJSON(live.node), next), { layout: next })
  }

  const layoutName = (l: ColumnLayout) =>
    ({
      '1-1': t('editor.blocks_v2.columns.layout_halves', 'Two equal columns'),
      '1-2': t('editor.blocks_v2.columns.layout_narrow_wide', 'Narrow, then wide'),
      '2-1': t('editor.blocks_v2.columns.layout_wide_narrow', 'Wide, then narrow'),
      '1-1-1': t('editor.blocks_v2.columns.layout_thirds', 'Three columns'),
      '1-1-1-1': t('editor.blocks_v2.columns.layout_quarters', 'Four columns'),
    })[l]

  const tools = (
    <BlockPopover
      open={open}
      onOpenChange={setOpen}
      title={t('editor.blocks_v2.columns.label', 'Columns')}
      trigger={
        <BlockToolbarButton label={t('editor.blocks_v2.columns.layout', 'Layout')} active={open}>
          <ColumnsIcon size={14} />
        </BlockToolbarButton>
      }
    >
      <SettingsField label={t('editor.blocks_v2.columns.layout', 'Layout')}>
        <div role="radiogroup" aria-label={t('editor.blocks_v2.columns.layout', 'Layout')} className="grid grid-cols-5 gap-1">
          {COLUMN_LAYOUTS.map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={l === layout}
              aria-label={layoutName(l)}
              title={layoutName(l)}
              onClick={() => setLayout(l)}
              className={cn(
                'flex h-9 items-center justify-center rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sky-500/40',
                l === layout ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-500 hover:text-neutral-800',
              )}
            >
              <LayoutGlyph layout={l} />
            </button>
          ))}
        </div>
      </SettingsField>
      <SettingsField label={t('editor.blocks_v2.columns.gap', 'Spacing')}>
        <Segmented
          ariaLabel={t('editor.blocks_v2.columns.gap', 'Spacing')}
          value={gap}
          onChange={(v) => commitAttrs(props, { gap: v })}
          options={[
            { value: 'sm', label: t('editor.blocks_v2.layout.size_sm', 'Small') },
            { value: 'md', label: t('editor.blocks_v2.layout.size_md', 'Medium') },
            { value: 'lg', label: t('editor.blocks_v2.layout.size_lg', 'Large') },
          ]}
        />
      </SettingsField>
      <SettingsField label={t('editor.blocks_v2.columns.align', 'Vertical alignment')}>
        <Segmented
          ariaLabel={t('editor.blocks_v2.columns.align', 'Vertical alignment')}
          value={valign}
          onChange={(v) => commitAttrs(props, { verticalAlign: v })}
          options={[
            { value: 'top', label: t('editor.blocks_v2.columns.align_top', 'Top') },
            { value: 'center', label: t('editor.blocks_v2.columns.align_center', 'Middle') },
            { value: 'bottom', label: t('editor.blocks_v2.columns.align_bottom', 'Bottom') },
          ]}
        />
      </SettingsField>
      <SwitchRow label={t('editor.blocks_v2.columns.stack', 'Stack on small screens')} checked={stack} onChange={(v) => commitAttrs(props, { stackOnMobile: v })} />
    </BlockPopover>
  )

  return (
    <NodeViewWrapper
      className="lh-columns lh-layout my-4"
      data-layout={layout}
      data-gap={gap}
      data-valign={valign}
      data-stack={stack ? 'true' : 'false'}
      data-editing={isEditable ? '' : undefined}
      style={{ '--lh-cols': columnTracks(effectiveLayout(layout, node.childCount)) } as React.CSSProperties}
    >
      <EditorBlockFrame
        editable={isEditable}
        node={node}
        editor={props.editor}
        getPos={props.getPos}
        selected={props.selected}
        tone="neutral"
        label={t('editor.blocks_v2.columns.label', 'Columns')}
        tools={tools}
        editableContent
        forceToolbar={open}
      >
        <NodeViewContent className="lh-columns-grid" />
      </EditorBlockFrame>
    </NodeViewWrapper>
  )
}

export { ColumnView } from './ColumnView'
