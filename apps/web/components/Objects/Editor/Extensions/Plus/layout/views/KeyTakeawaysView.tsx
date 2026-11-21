'use client'
/*
 Key takeaways: a tinted summary card with an icon, a title and ordinary
 blocks (seeded with a bullet list). An empty title shows "Key takeaways" in
 the learner's language.
*/
import React from 'react'
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { Lightbulb, Palette } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import EditorBlockFrame from '../../../../Blocks/ui/EditorBlockFrame'
import { BlockPopover, BlockToolbarButton, SettingsField } from '../../../../Blocks/ui/BlockChrome'
import { cn } from '@/lib/utils'
import { iconOf, toneOf } from '../layoutModel'
import { commitAttrs, LAYOUT_ICON_COMPONENTS, TONE_CLASSES, ToneSwatches } from '../shared'
import { IconPicker, useToneLabel } from './TimelineView'

export default function KeyTakeawaysView(props: NodeViewProps) {
  const { t } = useTranslation()
  const toneLabel = useToneLabel()
  const isEditable = !!(useEditorProvider() as any)?.isEditable
  const { node } = props
  const tone = toneOf(node.attrs.tone) ?? 'amber'
  const icon = iconOf(node.attrs.icon)
  const Icon = icon ? LAYOUT_ICON_COMPONENTS[icon] : Lightbulb
  const title: string = typeof node.attrs.title === 'string' ? node.attrs.title : ''
  const fallbackTitle = t('activities.key_takeaways.title', 'Key takeaways')
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState(title)
  const typing = React.useRef(false)
  React.useEffect(() => {
    if (!typing.current) setDraft(title)
  }, [title])
  const classes = TONE_CLASSES[tone]

  const tools = (
    <BlockPopover
      open={open}
      onOpenChange={setOpen}
      title={t('editor.blocks_v2.key_takeaways.label', 'Key takeaways')}
      trigger={
        <BlockToolbarButton label={t('editor.blocks_v2.layout.color', 'Color')} active={open}>
          <Palette size={14} />
        </BlockToolbarButton>
      }
    >
      <SettingsField label={t('editor.blocks_v2.layout.color', 'Color')}>
        <ToneSwatches value={tone} label={t('editor.blocks_v2.layout.color', 'Color')} toneLabel={toneLabel} onChange={(v) => commitAttrs(props, { tone: v })} />
      </SettingsField>
      <SettingsField label={t('editor.blocks_v2.layout.icon', 'Icon')}>
        <IconPicker value={icon} onChange={(v) => commitAttrs(props, { icon: v })} noneLabel={t('editor.blocks_v2.layout.icon_default', 'Default')} />
      </SettingsField>
    </BlockPopover>
  )

  return (
    <NodeViewWrapper className="lh-key-takeaways lh-layout my-4" data-tone={tone}>
      <EditorBlockFrame
        editable={isEditable}
        node={node}
        editor={props.editor}
        getPos={props.getPos}
        selected={props.selected}
        tone="neutral"
        label={t('editor.blocks_v2.key_takeaways.label', 'Key takeaways')}
        tools={tools}
        editableContent
        forceToolbar={open}
      >
        <aside aria-label={title || fallbackTitle} className={cn('rounded-2xl px-5 pb-2 pt-4 ring-1 ring-inset', classes.card, classes.ink)}>
          <div contentEditable={false} className="mb-1 flex items-center gap-2.5">
            <span className={cn('flex h-7 w-7 flex-none items-center justify-center rounded-lg', classes.soft)}>
              <Icon size={16} weight="fill" />
            </span>
            {isEditable ? (
              <input
                value={draft}
                placeholder={fallbackTitle}
                aria-label={t('editor.blocks_v2.key_takeaways.title_label', 'Card title')}
                onFocus={() => (typing.current = true)}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => {
                  typing.current = false
                  if (draft !== title) commitAttrs(props, { title: draft.slice(0, 120) })
                }}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter' || e.key === 'Escape') {
                    e.preventDefault()
                    if (e.key === 'Escape') setDraft(title)
                    ;(e.target as HTMLInputElement).blur()
                  }
                }}
                className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none placeholder:text-current placeholder:opacity-60"
              />
            ) : (
              <p className="m-0 text-[15px] font-semibold">{title || fallbackTitle}</p>
            )}
          </div>
          <NodeViewContent className="lh-kt-body" />
        </aside>
      </EditorBlockFrame>
    </NodeViewWrapper>
  )
}
