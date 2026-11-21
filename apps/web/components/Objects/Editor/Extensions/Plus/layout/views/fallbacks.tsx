'use client'
/*
 What a layout block shows while its view's chunk loads (see ../../lazyView):
 the view's own learner markup before hydration, minus icons and handlers.
 Every tab panel shows under its title, columns sit on their grid, timeline
 steps keep their labels, so the text is on the page at once (server renders
 included) and the view takes over without moving anything.
*/
import React from 'react'
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import type { Node as PMNode } from '@tiptap/pm/model'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  ACCORDION_VARIANTS,
  COLUMN_GAPS,
  COLUMN_LAYOUTS,
  COLUMN_VALIGNS,
  TAB_VARIANTS,
  TIMELINE_ORIENTATIONS,
  TIMELINE_VARIANTS,
  checklistItemKey,
  checklistStorageKey,
  columnTracks,
  effectiveLayout,
  hashText,
  oneOf,
  toneOf,
} from '../layoutModel'
import { checklistStore, isTicked } from '../checklistStore'
import { TONE_CLASSES } from '../base'

export function TabsFallback({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper className="lh-tabs lh-layout my-4" data-variant={oneOf(TAB_VARIANTS, node.attrs.variant, 'line')}>
      <div className="lh-tabs-panels">
        <NodeViewContent className="lh-tabs-content" />
      </div>
    </NodeViewWrapper>
  )
}

export function ColumnsFallback({ node }: NodeViewProps) {
  const layout = oneOf(COLUMN_LAYOUTS, node.attrs.layout, '1-1')
  return (
    <NodeViewWrapper
      className="lh-columns lh-layout my-4"
      data-layout={layout}
      data-gap={oneOf(COLUMN_GAPS, node.attrs.gap, 'md')}
      data-valign={oneOf(COLUMN_VALIGNS, node.attrs.verticalAlign, 'top')}
      data-stack={node.attrs.stackOnMobile !== false ? 'true' : 'false'}
      style={{ '--lh-cols': columnTracks(effectiveLayout(layout, node.childCount)) } as React.CSSProperties}
    >
      <NodeViewContent className="lh-columns-grid" />
    </NodeViewWrapper>
  )
}

export function AccordionFallback({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper
      className="lh-accordion lh-layout my-4"
      data-lh-accordion=""
      data-variant={oneOf(ACCORDION_VARIANTS, node.attrs.variant, 'default')}
      data-single={node.attrs.single !== false ? 'true' : 'false'}
    >
      <NodeViewContent className="lh-accordion-body" />
    </NodeViewWrapper>
  )
}

export function TimelineFallback({ node }: NodeViewProps) {
  const { t } = useTranslation()
  return (
    <NodeViewWrapper
      className="lh-timeline lh-layout my-4"
      data-variant={oneOf(TIMELINE_VARIANTS, node.attrs.variant, 'steps')}
      data-orientation={oneOf(TIMELINE_ORIENTATIONS, node.attrs.orientation, 'vertical')}
      data-numbered={node.attrs.numbered !== false ? 'true' : 'false'}
    >
      <NodeViewContent className="lh-timeline-list" role="list" aria-label={t('activities.timeline.list_label', 'Timeline')} />
    </NodeViewWrapper>
  )
}

export function TimelineItemFallback({ node }: NodeViewProps) {
  const title: string = typeof node.attrs.title === 'string' ? node.attrs.title : ''
  const label: string = typeof node.attrs.label === 'string' ? node.attrs.label : ''
  const tone = toneOf(node.attrs.tone)
  return (
    <NodeViewWrapper className="lh-tl-item group/tl" role="listitem" data-tone={tone ?? undefined}>
      <span aria-hidden contentEditable={false} className={cn('lh-tl-marker', tone ? TONE_CLASSES[tone].dot : 'bg-neutral-900 text-white')} />
      <div className="lh-tl-content min-w-0">
        <div contentEditable={false} className="lh-tl-head flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {label && <div className={cn('lh-tl-label text-[12px] font-semibold', tone ? TONE_CLASSES[tone].icon : 'text-neutral-500')}>{label}</div>}
            {title && <div className="lh-tl-title text-[16px] font-semibold text-neutral-900">{title}</div>}
          </div>
        </div>
        <NodeViewContent className="lh-tl-body" />
      </div>
    </NodeViewWrapper>
  )
}

export function KeyTakeawaysFallback({ node }: NodeViewProps) {
  const { t } = useTranslation()
  const classes = TONE_CLASSES[toneOf(node.attrs.tone) ?? 'amber']
  const title = (typeof node.attrs.title === 'string' ? node.attrs.title : '') || t('activities.key_takeaways.title', 'Key takeaways')
  return (
    <NodeViewWrapper className="lh-key-takeaways lh-layout my-4" data-tone={toneOf(node.attrs.tone) ?? 'amber'}>
      <aside aria-label={title} className={cn('rounded-2xl px-5 pb-2 pt-4 ring-1 ring-inset', classes.card, classes.ink)}>
        <div contentEditable={false} className="mb-1 flex items-center gap-2.5">
          <span className={cn('flex h-7 w-7 flex-none items-center justify-center rounded-lg', classes.soft)} />
          <p className="m-0 text-[15px] font-semibold">{title}</p>
        </div>
        <NodeViewContent className="lh-kt-body" />
      </aside>
    </NodeViewWrapper>
  )
}

export function ChecklistFallback({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper className="lh-checklist lh-layout my-3" data-learner-can-check={node.attrs.learnerCanCheck !== false ? 'true' : 'false'}>
      <NodeViewContent className="lh-checklist-items" role="list" />
    </NodeViewWrapper>
  )
}

const noTicks = () => () => {}

export function ChecklistItemFallback(props: NodeViewProps) {
  const { t } = useTranslation()
  const { node, editor } = props
  let list: PMNode | null = null
  try {
    const pos = typeof props.getPos === 'function' ? props.getPos() : undefined
    list = (editor as any)?.state?.doc?.resolve?.(typeof pos === 'number' ? pos : 0)?.parent ?? null
  } catch {
    list = null
  }
  const canCheck = list ? list.attrs?.learnerCanCheck !== false : false
  const blockId = list && typeof list.attrs.blockId === 'string' && list.attrs.blockId ? list.attrs.blockId : hashText(list?.textContent ?? '')
  const key = list ? checklistStorageKey((props.extension?.options as any)?.activityId, blockId) : ''
  const ticks = React.useSyncExternalStore(noTicks, () => checklistStore.get(key), () => checklistStore.getServer())
  const checked = canCheck ? isTicked(ticks, checklistItemKey(node.textContent), !!node.attrs.checked) : !!node.attrs.checked
  const text = node.textContent.trim() || t('activities.checklist.item', 'Checklist item')
  return (
    <NodeViewWrapper className="lh-check-item" role="listitem" data-checked={checked ? 'true' : 'false'}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={text}
        disabled={!canCheck}
        contentEditable={false}
        className={cn(
          'lh-check-box mt-[3px] flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[5px] outline-none',
          checked ? 'bg-green-600 text-white' : 'bg-white ring-1 ring-inset ring-neutral-300',
          canCheck ? 'cursor-pointer' : 'cursor-default opacity-80',
        )}
      />
      <NodeViewContent className={cn('lh-check-text min-w-0 flex-1', checked && 'text-neutral-400 line-through')} />
    </NodeViewWrapper>
  )
}
