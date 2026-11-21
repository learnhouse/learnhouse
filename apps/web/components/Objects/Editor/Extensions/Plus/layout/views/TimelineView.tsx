'use client'
/*
 Timeline: ordered `timelineItem` steps, each with a title, an optional label
 (a date or "Week 1") and ordinary blocks. Numbers come from a CSS counter,
 so a step never needs to know its index. Horizontal timelines fall back to
 vertical in a narrow container (layout.css).
*/
import React from 'react'
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { Palette, Plus, SlidersHorizontal, Trash } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import EditorBlockFrame from '../../../../Blocks/ui/EditorBlockFrame'
import { BlockPopover, BlockToolbarButton, Segmented, SettingsField } from '../../../../Blocks/ui/BlockChrome'
import { cn } from '@/lib/utils'
import { LAYOUT_ICONS, TIMELINE_ORIENTATIONS, TIMELINE_VARIANTS, iconOf, oneOf, toneOf, type LayoutIcon, type LayoutTone } from '../layoutModel'
import { appendChild, commitAttrs, hasLiveDoc, LAYOUT_ICON_COMPONENTS, liveNode, SwitchRow, TONE_CLASSES, ToneSwatches } from '../shared'

export function useToneLabel() {
  const { t } = useTranslation()
  return (tone: LayoutTone) =>
    ({
      neutral: t('editor.blocks_v2.layout.tone_neutral', 'Neutral'),
      blue: t('editor.blocks_v2.layout.tone_blue', 'Blue'),
      teal: t('editor.blocks_v2.layout.tone_teal', 'Teal'),
      green: t('editor.blocks_v2.layout.tone_green', 'Green'),
      amber: t('editor.blocks_v2.layout.tone_amber', 'Amber'),
      rose: t('editor.blocks_v2.layout.tone_rose', 'Rose'),
    })[tone]
}

export default function TimelineView(props: NodeViewProps) {
  const { t } = useTranslation()
  const isEditable = !!(useEditorProvider() as any)?.isEditable
  const { node } = props
  const variant = oneOf(TIMELINE_VARIANTS, node.attrs.variant, 'steps')
  const orientation = oneOf(TIMELINE_ORIENTATIONS, node.attrs.orientation, 'vertical')
  const numbered = node.attrs.numbered !== false
  const [open, setOpen] = React.useState(false)

  const tools = (
    <>
      <BlockToolbarButton
        label={t('editor.blocks_v2.timeline.add', 'Add step')}
        onClick={() => appendChild(props, { type: 'timelineItem', attrs: { title: '', label: '' }, content: [{ type: 'paragraph' }] })}
      >
        <Plus size={14} />
      </BlockToolbarButton>
      <BlockPopover
        open={open}
        onOpenChange={setOpen}
        title={t('editor.blocks_v2.timeline.label', 'Timeline')}
        trigger={
          <BlockToolbarButton label={t('editor.blocks_v2.layout.settings', 'Settings')} active={open}>
            <SlidersHorizontal size={14} />
          </BlockToolbarButton>
        }
      >
        <SettingsField label={t('editor.blocks_v2.layout.style', 'Style')}>
          <Segmented
            ariaLabel={t('editor.blocks_v2.layout.style', 'Style')}
            value={variant}
            onChange={(v) => commitAttrs(props, { variant: v })}
            options={[
              { value: 'steps', label: t('editor.blocks_v2.timeline.variant_steps', 'Steps') },
              { value: 'timeline', label: t('editor.blocks_v2.timeline.variant_timeline', 'Timeline') },
              { value: 'process', label: t('editor.blocks_v2.timeline.variant_process', 'Process') },
            ]}
          />
        </SettingsField>
        <SettingsField label={t('editor.blocks_v2.timeline.orientation', 'Direction')}>
          <Segmented
            ariaLabel={t('editor.blocks_v2.timeline.orientation', 'Direction')}
            value={orientation}
            onChange={(v) => commitAttrs(props, { orientation: v })}
            options={[
              { value: 'vertical', label: t('editor.blocks_v2.timeline.vertical', 'Vertical') },
              { value: 'horizontal', label: t('editor.blocks_v2.timeline.horizontal', 'Horizontal') },
            ]}
          />
        </SettingsField>
        <SwitchRow label={t('editor.blocks_v2.timeline.numbered', 'Numbered steps')} checked={numbered} onChange={(v) => commitAttrs(props, { numbered: v })} />
      </BlockPopover>
    </>
  )

  return (
    <NodeViewWrapper className="lh-timeline lh-layout my-4" data-variant={variant} data-orientation={orientation} data-numbered={numbered ? 'true' : 'false'}>
      <EditorBlockFrame
        editable={isEditable}
        node={node}
        editor={props.editor}
        getPos={props.getPos}
        selected={props.selected}
        tone="neutral"
        label={t('editor.blocks_v2.timeline.label', 'Timeline')}
        tools={tools}
        editableContent
        forceToolbar={open}
      >
        <NodeViewContent className="lh-timeline-list" role="list" aria-label={t('activities.timeline.list_label', 'Timeline')} />
      </EditorBlockFrame>
    </NodeViewWrapper>
  )
}

function ItemField({ value, placeholder, className, onCommit }: { value: string; placeholder: string; className: string; onCommit: (_v: string) => void }) {
  const [draft, setDraft] = React.useState(value)
  const typing = React.useRef(false)
  React.useEffect(() => {
    if (!typing.current) setDraft(value)
  }, [value])
  return (
    <input
      value={draft}
      placeholder={placeholder}
      aria-label={placeholder}
      onFocus={() => (typing.current = true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        typing.current = false
        if (draft !== value) onCommit(draft.slice(0, 200))
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault()
          if (e.key === 'Escape') setDraft(value)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      className={cn('w-full min-w-0 bg-transparent outline-none placeholder:text-neutral-400', className)}
    />
  )
}

export function TimelineItemView(props: NodeViewProps) {
  const { t } = useTranslation()
  const toneLabel = useToneLabel()
  const isEditable = !!(useEditorProvider() as any)?.isEditable
  const { node } = props
  const title: string = typeof node.attrs.title === 'string' ? node.attrs.title : ''
  const label: string = typeof node.attrs.label === 'string' ? node.attrs.label : ''
  const tone = toneOf(node.attrs.tone)
  const icon = iconOf(node.attrs.icon)
  const Icon = icon ? LAYOUT_ICON_COMPONENTS[icon] : null
  const [open, setOpen] = React.useState(false)

  const remove = () => {
    const live = liveNode(props)
    if (!live || !hasLiveDoc(props.editor)) return
    const $pos = props.editor.state.doc.resolve(live.pos)
    // A timeline keeps at least one step; delete the whole block instead.
    if ($pos.parent.childCount <= 1) return
    props.editor.view.dispatch(props.editor.state.tr.delete(live.pos, live.pos + live.node.nodeSize))
  }

  return (
    <NodeViewWrapper className="lh-tl-item group/tl" role="listitem" data-tone={tone ?? undefined}>
      <span aria-hidden contentEditable={false} className={cn('lh-tl-marker', tone ? TONE_CLASSES[tone].dot : 'bg-neutral-900 text-white')}>
        {Icon ? <Icon size={14} weight="bold" /> : null}
      </span>
      <div className="lh-tl-content min-w-0">
        <div contentEditable={false} className="lh-tl-head flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {isEditable ? (
              <>
                <ItemField value={label} placeholder={t('editor.blocks_v2.timeline.label_placeholder', 'Date or label (optional)')} className="lh-tl-label text-[12px] font-semibold" onCommit={(v) => commitAttrs(props, { label: v })} />
                <ItemField value={title} placeholder={t('editor.blocks_v2.timeline.title_placeholder', 'Step title')} className="lh-tl-title text-[16px] font-semibold text-neutral-900" onCommit={(v) => commitAttrs(props, { title: v })} />
              </>
            ) : (
              <>
                {label && <div className={cn('lh-tl-label text-[12px] font-semibold', tone ? TONE_CLASSES[tone].icon : 'text-neutral-500')}>{label}</div>}
                {title && <div className="lh-tl-title text-[16px] font-semibold text-neutral-900">{title}</div>}
              </>
            )}
          </div>
          {isEditable && (
            <div className="flex flex-none items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/tl:opacity-100">
              <BlockPopover
                open={open}
                onOpenChange={setOpen}
                title={t('editor.blocks_v2.timeline.step', 'Step')}
                trigger={
                  <BlockToolbarButton label={t('editor.blocks_v2.layout.color', 'Color')} active={open}>
                    <Palette size={13} />
                  </BlockToolbarButton>
                }
              >
                <SettingsField label={t('editor.blocks_v2.layout.color', 'Color')}>
                  <ToneSwatches value={tone} label={t('editor.blocks_v2.layout.color', 'Color')} toneLabel={toneLabel} onChange={(v) => commitAttrs(props, { tone: v === tone ? null : v })} />
                </SettingsField>
                <SettingsField label={t('editor.blocks_v2.layout.icon', 'Icon')}>
                  <IconPicker value={icon} onChange={(v) => commitAttrs(props, { icon: v })} noneLabel={t('editor.blocks_v2.timeline.icon_number', 'Number')} />
                </SettingsField>
              </BlockPopover>
              <BlockToolbarButton label={t('editor.blocks_v2.timeline.remove', 'Delete step')} tone="danger" onClick={remove}>
                <Trash size={13} />
              </BlockToolbarButton>
            </div>
          )}
        </div>
        <NodeViewContent className="lh-tl-body" />
      </div>
    </NodeViewWrapper>
  )
}

export function IconPicker({ value, onChange, noneLabel }: { value: LayoutIcon | null; onChange: (_v: LayoutIcon | null) => void; noneLabel: string }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap gap-1">
      <button
        type="button"
        aria-pressed={value === null}
        onClick={() => onChange(null)}
        className={cn('h-7 rounded-md px-2 text-[11px] font-medium', value === null ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600 hover:text-neutral-900')}
      >
        {noneLabel}
      </button>
      {LAYOUT_ICONS.map((key) => {
        const Icon = LAYOUT_ICON_COMPONENTS[key]
        return (
          <button
            key={key}
            type="button"
            aria-label={t(`editor.blocks_v2.layout.icons.${key}`, key)}
            title={t(`editor.blocks_v2.layout.icons.${key}`, key)}
            aria-pressed={value === key}
            onClick={() => onChange(key)}
            className={cn('flex h-7 w-7 items-center justify-center rounded-md', value === key ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600 hover:text-neutral-900')}
          >
            <Icon size={14} weight="bold" />
          </button>
        )
      })}
    </div>
  )
}
