'use client'
/*
 Checklist: TipTap's taskList / taskItem. Authors tick items in the editor to
 set their default state (the stock task item view). Learners tick them for
 themselves: ticks are kept in their browser (checklistStore), never in the
 document, and the list shows their progress.
*/
import React from 'react'
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import type { Node as PMNode } from '@tiptap/pm/model'
import { ArrowCounterClockwise, Check, SlidersHorizontal } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import EditorBlockFrame from '../../../../Blocks/ui/EditorBlockFrame'
import { BlockPopover, BlockToolbarButton } from '../../../../Blocks/ui/BlockChrome'
import { cn } from '@/lib/utils'
import { checklistItemKey, checklistStorageKey, hashText } from '../layoutModel'
import { checklistStore, isTicked } from '../checklistStore'
import { commitAttrs, SwitchRow, useHydrated } from '../shared'

export function listStorageKey(list: PMNode, activityId: unknown): string {
  const blockId = typeof list.attrs.blockId === 'string' && list.attrs.blockId ? list.attrs.blockId : hashText(list.textContent)
  return checklistStorageKey(activityId, blockId)
}

function useTicks(key: string) {
  return React.useSyncExternalStore(
    React.useCallback((fn: () => void) => checklistStore.subscribe(key, fn), [key]),
    () => checklistStore.get(key),
    () => checklistStore.getServer(),
  )
}

export function checklistProgress(list: PMNode, ticks: Record<string, boolean>) {
  let done = 0
  list.forEach((item) => {
    if (isTicked(ticks, checklistItemKey(item.textContent), !!item.attrs.checked)) done += 1
  })
  return { done, total: list.childCount }
}

export default function ChecklistView(props: NodeViewProps) {
  const { t } = useTranslation()
  const isEditable = !!(useEditorProvider() as any)?.isEditable
  const hydrated = useHydrated()
  const { node } = props
  const canCheck = node.attrs.learnerCanCheck !== false
  const key = listStorageKey(node, (props.extension?.options as any)?.activityId)
  const ticks = useTicks(key)
  const { done, total } = checklistProgress(node, ticks)
  const [open, setOpen] = React.useState(false)
  const anyTicked = Object.keys(ticks).length > 0

  if (isEditable) {
    return (
      <NodeViewWrapper className="lh-checklist lh-layout my-3">
        <EditorBlockFrame
          editable
          node={node}
          editor={props.editor}
          getPos={props.getPos}
          selected={props.selected}
          tone="neutral"
          label={t('editor.blocks_v2.checklist.label', 'Checklist')}
          editableContent
          forceToolbar={open}
          tools={
            <BlockPopover
              open={open}
              onOpenChange={setOpen}
              title={t('editor.blocks_v2.checklist.label', 'Checklist')}
              trigger={
                <BlockToolbarButton label={t('editor.blocks_v2.layout.settings', 'Settings')} active={open}>
                  <SlidersHorizontal size={14} />
                </BlockToolbarButton>
              }
            >
              <SwitchRow
                label={t('editor.blocks_v2.checklist.learner_can_check', 'Learners can tick items')}
                checked={canCheck}
                onChange={(v) => commitAttrs(props, { learnerCanCheck: v })}
              />
              <p className="m-0 text-[11px] leading-snug text-neutral-400">
                {t('editor.blocks_v2.checklist.hint', 'Ticks are saved in each learner’s browser. Items you tick here start ticked.')}
              </p>
            </BlockPopover>
          }
        >
          <NodeViewContent<"ul"> as="ul" data-type="taskList" className="lh-checklist-items" />
        </EditorBlockFrame>
      </NodeViewWrapper>
    )
  }

  const showProgress = canCheck && hydrated && total > 0
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <NodeViewWrapper className="lh-checklist lh-layout my-3" data-learner-can-check={canCheck ? 'true' : 'false'}>
      {showProgress && (
        <div contentEditable={false} className="lh-checklist-progress mb-1.5 flex items-center gap-3">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={done}
            aria-label={t('activities.checklist.progress_label', '{{done}} of {{total}} done', { done, total })}
            className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-200/70"
          >
            <div className={cn('lh-checklist-bar h-full rounded-full', done === total ? 'bg-green-600' : 'bg-neutral-800')} style={{ width: `${pct}%` }} />
          </div>
          <span className="flex-none text-[12px] font-semibold tabular-nums text-neutral-500" aria-hidden>
            {t('activities.checklist.progress', '{{done}}/{{total}}', { done, total })}
          </span>
          {anyTicked && (
            <button
              type="button"
              onClick={() => checklistStore.reset(key)}
              aria-label={t('activities.checklist.reset', 'Reset checklist')}
              title={t('activities.checklist.reset', 'Reset checklist')}
              className="flex h-6 w-6 flex-none items-center justify-center rounded-md text-neutral-400 outline-none hover:bg-black/5 hover:text-neutral-700 focus-visible:ring-2 focus-visible:ring-sky-500/40"
            >
              <ArrowCounterClockwise size={13} />
            </button>
          )}
        </div>
      )}
      <NodeViewContent className="lh-checklist-items" role="list" />
    </NodeViewWrapper>
  )
}

/** A learner's checklist item (preview and learner renders; the editor keeps the stock view). */
export function ChecklistItemView(props: NodeViewProps) {
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
  const key = list ? listStorageKey(list, (props.extension?.options as any)?.activityId) : ''
  const ticks = useTicks(key)
  const itemKey = checklistItemKey(node.textContent)
  const checked = canCheck ? isTicked(ticks, itemKey, !!node.attrs.checked) : !!node.attrs.checked
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
        onClick={() => canCheck && checklistStore.set(key, itemKey, !checked)}
        className={cn(
          'lh-check-box mt-[3px] flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sky-500/40',
          checked ? 'bg-green-600 text-white' : 'bg-white ring-1 ring-inset ring-neutral-300',
          canCheck ? 'cursor-pointer hover:ring-neutral-500' : 'cursor-default opacity-80',
        )}
      >
        {checked && <Check size={12} weight="bold" />}
      </button>
      <NodeViewContent className={cn('lh-check-text min-w-0 flex-1', checked && 'text-neutral-400 line-through')} />
    </NodeViewWrapper>
  )
}
