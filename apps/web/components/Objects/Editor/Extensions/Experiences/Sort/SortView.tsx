'use client'
/*
 "Sort it" (node expSort): learners put item chips into the right group.

 Author: a single-column form (groups, items with their correct group and an
 optional explanation, shuffle toggle) with inline hints, and "Preview as
 learner" in the frame header.

 Learner: chips in a tray; drag one onto a group (mouse, pen, touch
 press-and-hold) or tap a chip, then tap a group. Keyboard: Tab to a chip,
 Enter / Space selects it, 1–4 drops it straight into that group, arrow keys
 move between chips, Escape clears the selection. "Check" marks every chip
 ✓ / ✗ with an explanation for the wrong ones; "Retry wrong ones" sends only
 those back to the tray.
*/
import React from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { ArrowCounterClockwise, Stack, Trash, Tray } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { CommitInput, FIELD_CLASS } from '../../../Blocks/ui/BlockChrome'
import {
  ExperienceFooter,
  ExperienceFrame,
  Stars,
  buzz,
  newId,
  useEnsureBlockId,
  useExperienceEditable,
  useExperienceMemory,
  useLiveAttrs,
  type CommitPatch,
} from '../shared'
import {
  SORT_COLORS,
  SORT_LIMITS,
  addCategory,
  addItem,
  allPlaced,
  checkSort,
  isPlayable,
  normalizeSort,
  place,
  playableSort,
  removeCategory,
  removeItem,
  retryWrong,
  trayOrder,
  unplacedIds,
  updateCategory,
  updateItem,
  validateSort,
  type SortCheck,
  type SortColor,
  type SortData,
  type SortPlacement,
} from './sortModel'
import { AddRowButton, BlockHints, DragGhost, FormSection, ICON_BTN, NotReady, ResultIcon, RowHints, contentKey } from './kit'
import { focusSibling, useTapDrag } from './useTapDrag'

const TONE = 'interactive' as const
const TRAY = '__tray__'

/** Per-group colours (dot, zone surface, zone while a chip hovers it). */
const COLOR: Record<SortColor, { dot: string; zone: string; text: string }> = {
  sky: { dot: 'bg-sky-500', zone: 'text-sky-500', text: 'text-sky-800' },
  amber: { dot: 'bg-amber-500', zone: 'text-amber-500', text: 'text-amber-800' },
  emerald: { dot: 'bg-emerald-500', zone: 'text-emerald-500', text: 'text-emerald-800' },
  rose: { dot: 'bg-rose-500', zone: 'text-rose-500', text: 'text-rose-800' },
}

type Frame = {
  tone: typeof TONE
  icon: React.ReactNode
  editable: boolean
  preview: boolean
  onPreviewChange: (_v: boolean) => void
  nodeView: NodeViewProps
  label: string
}

export default function SortView(props: NodeViewProps) {
  const { t } = useTranslation()
  const editable = useExperienceEditable(props)
  useEnsureBlockId(props, editable)
  const [attrs, commit] = useLiveAttrs(props)
  const data = React.useMemo(() => normalizeSort(attrs), [attrs])
  const [preview, setPreview] = React.useState(false)
  const frame: Frame = {
    tone: TONE,
    icon: <Stack weight="duotone" />,
    editable,
    preview,
    onPreviewChange: setPreview,
    nodeView: props,
    label: t('editor.experiences.sort.title', 'Sort it'),
  }
  const playable = React.useMemo(() => playableSort(data), [data])
  return (
    <NodeViewWrapper className="block-exp-sort">
      {editable && !preview ? (
        <SortEditor data={data} commit={commit} frame={frame} />
      ) : (
        <SortPlayer key={contentKey(playable)} data={playable} frame={frame} source={props} />
      )}
    </NodeViewWrapper>
  )
}

// ─── Author form ────────────────────────────────────────────────────────────

function SortEditor({ data, commit, frame }: { data: SortData; commit: (_p: CommitPatch<Record<string, any>>) => void; frame: Frame }) {
  const { t } = useTranslation()
  const issues = React.useMemo(() => validateSort(data), [data])
  const edit = (fn: (_d: SortData) => SortData) =>
    commit((live) => {
      const next = fn(normalizeSort(live))
      return { categories: next.categories, items: next.items }
    })
  const issueText = (code: string) => t(`editor.experiences.sort.issues.${code}`, ISSUE_FALLBACK[code] ?? code)
  const canRemoveCat = data.categories.length > SORT_LIMITS.minCategories
  const canRemoveItem = data.items.length > SORT_LIMITS.minItems

  return (
    <ExperienceFrame
      {...frame}
      title={data.title}
      onTitleChange={(title) => commit({ title })}
      instructions={data.instructions}
      onInstructionsChange={(instructions) => commit({ instructions })}
    >
      <div className="flex flex-col gap-5">
        <BlockHints issues={issues} text={issueText} />

        <FormSection title={t('editor.experiences.sort.groups_heading', 'Groups')}>
          {data.categories.map((c, i) => (
            <div key={c.id} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={ICON_BTN}
                  onClick={() => edit((d) => updateCategory(d, c.id, { color: SORT_COLORS[(SORT_COLORS.indexOf(c.color) + 1) % SORT_COLORS.length] }))}
                  aria-label={t('editor.experiences.sort.change_color', 'Change colour')}
                  title={t('editor.experiences.sort.change_color', 'Change colour')}
                >
                  <span aria-hidden className={cn('h-3.5 w-3.5 rounded-full', COLOR[c.color].dot)} />
                </button>
                <CommitInput
                  value={c.label}
                  onCommit={(label) => edit((d) => updateCategory(d, c.id, { label }))}
                  placeholder={t('editor.experiences.sort.group_placeholder', { n: i + 1, defaultValue: 'Group {{n}}' })}
                  aria-label={t('editor.experiences.sort.group_label', { n: i + 1, defaultValue: 'Group {{n}} name' })}
                  className={cn(FIELD_CLASS, 'h-9 min-w-0 flex-1')}
                />
                <button
                  type="button"
                  className={ICON_BTN}
                  disabled={!canRemoveCat}
                  onClick={() => edit((d) => removeCategory(d, c.id))}
                  aria-label={t('editor.experiences.sort.remove_group', 'Remove group')}
                  title={t('editor.experiences.sort.remove_group', 'Remove group')}
                >
                  <Trash size={15} aria-hidden />
                </button>
              </div>
              <RowHints issues={issues} id={c.id} text={issueText} />
            </div>
          ))}
          <AddRowButton disabled={data.categories.length >= SORT_LIMITS.maxCategories} onClick={() => edit((d) => addCategory(d, newId()))}>
            {t('editor.experiences.sort.add_group', 'Add group')}
          </AddRowButton>
        </FormSection>

        <FormSection title={t('editor.experiences.sort.items_heading', 'Items')} hint={t('editor.experiences.sort.items_hint', 'Pick the correct group for each item. Learners see them shuffled.')}>
          {data.items.map((it, i) => (
            <div key={it.id} className="flex flex-col gap-1.5 rounded-xl bg-neutral-50/80 p-2 ring-1 ring-neutral-100">
              <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
                <CommitInput
                  value={it.text}
                  onCommit={(text) => edit((d) => updateItem(d, it.id, { text }))}
                  placeholder={t('editor.experiences.sort.item_placeholder', { n: i + 1, defaultValue: 'Item {{n}}' })}
                  aria-label={t('editor.experiences.sort.item_placeholder', { n: i + 1, defaultValue: 'Item {{n}}' })}
                  className={cn(FIELD_CLASS, 'h-9 min-w-0 flex-1')}
                />
                <div className="flex items-center gap-1.5">
                  <select
                    value={it.categoryId}
                    onChange={(e) => edit((d) => updateItem(d, it.id, { categoryId: e.target.value }))}
                    aria-label={t('editor.experiences.sort.item_group', 'Correct group')}
                    className={cn(FIELD_CLASS, 'h-9 min-w-0 flex-1 sm:w-40 sm:flex-none')}
                  >
                    {!data.categories.some((c) => c.id === it.categoryId) && <option value="">{t('editor.experiences.sort.pick_group', 'Pick a group')}</option>}
                    {data.categories.map((c, ci) => (
                      <option key={c.id} value={c.id}>
                        {c.label.trim() || t('editor.experiences.sort.group_placeholder', { n: ci + 1, defaultValue: 'Group {{n}}' })}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={ICON_BTN}
                    disabled={!canRemoveItem}
                    onClick={() => edit((d) => removeItem(d, it.id))}
                    aria-label={t('editor.experiences.sort.remove_item', 'Remove item')}
                    title={t('editor.experiences.sort.remove_item', 'Remove item')}
                  >
                    <Trash size={15} aria-hidden />
                  </button>
                </div>
              </div>
              <CommitInput
                value={it.explanation ?? ''}
                onCommit={(explanation) => edit((d) => updateItem(d, it.id, { explanation }))}
                placeholder={t('editor.experiences.sort.explanation_placeholder', 'Why it belongs there (shown when wrong, optional)')}
                aria-label={t('editor.experiences.sort.explanation_label', 'Explanation')}
                className={cn(FIELD_CLASS, 'h-8 text-[12px]')}
              />
              <RowHints issues={issues} id={it.id} text={issueText} />
            </div>
          ))}
          <AddRowButton disabled={data.items.length >= SORT_LIMITS.maxItems} onClick={() => edit((d) => addItem(d, newId()))}>
            {t('editor.experiences.sort.add_item', 'Add item')}
          </AddRowButton>
        </FormSection>

        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-neutral-700">
          <input type="checkbox" checked={data.shuffle} onChange={(e) => commit({ shuffle: e.target.checked })} className="h-4 w-4 accent-neutral-900" />
          {t('editor.experiences.sort.shuffle_label', 'Shuffle items for learners')}
        </label>
      </div>
    </ExperienceFrame>
  )
}

const ISSUE_FALLBACK: Record<string, string> = {
  too_few_categories: 'Add at least 2 groups.',
  too_many_categories: 'Use at most 4 groups; learners only see the first 4.',
  too_few_items: 'Add at least 2 items.',
  too_many_items: 'Use at most 20 items; learners only see the first 20.',
  empty_category: 'Name this group, or remove it.',
  empty_item: 'This item is empty; learners will not see it.',
  item_no_category: 'Pick the correct group for this item.',
  unused_category: 'No item belongs to this group yet.',
  duplicate_item: 'Another item has the same text.',
}

// ─── Learner ────────────────────────────────────────────────────────────────

function SortPlayer({ data, frame, source }: { data: SortData; frame: Frame; source: NodeViewProps }) {
  const { t } = useTranslation()
  const memory = useExperienceMemory(data.blockId, source)
  const [order, setOrder] = React.useState(() => trayOrder(data))
  const [placement, setPlacement] = React.useState<SortPlacement>({})
  const [selected, setSelected] = React.useState<string | null>(null)
  const [check, setCheck] = React.useState<SortCheck | null>(null)
  const [live, setLive] = React.useState('')
  const [best, setBest] = React.useState<number>(() => memory.read<number>('best', 0))
  const rootRef = React.useRef<HTMLDivElement>(null)

  const itemById = React.useMemo(() => new Map(data.items.map((i) => [i.id, i])), [data])
  const catById = React.useMemo(() => new Map(data.categories.map((c) => [c.id, c])), [data])
  const textOf = (id: string) => itemById.get(id)?.text ?? ''
  const groupOf = (id: string | null | undefined) => (id ? catById.get(id)?.label ?? '' : '')

  const doPlace = (itemId: string, categoryId: string | null) => {
    if (check || !itemById.has(itemId)) return
    setPlacement((p) => place(p, itemId, categoryId))
    setSelected(null)
    setLive(
      categoryId
        ? t('activities.experiences.sort.placed', { item: textOf(itemId), group: groupOf(categoryId), defaultValue: 'Placed “{{item}}” in {{group}}.' })
        : t('activities.experiences.sort.returned', { item: textOf(itemId), defaultValue: 'Moved “{{item}}” back to the tray.' }),
    )
  }

  const { drag, itemProps } = useTapDrag({
    disabled: !!check,
    onDrop: (id, target) => doPlace(id, target === TRAY ? null : target),
  })

  const tapChip = (id: string) => {
    if (check) return
    const next = selected === id ? null : id
    setSelected(next)
    if (next) setLive(t('activities.experiences.sort.selected', { item: textOf(id), defaultValue: 'Selected “{{item}}”. Now choose a group.' }))
  }

  const onCheck = () => {
    const c = checkSort(data, placement)
    setCheck(c)
    buzz(c.perfect ? 'correct' : 'wrong')
    setSelected(null)
    setLive(
      c.perfect
        ? t('activities.experiences.sort.perfect', 'Perfect! Everything is in the right group.')
        : t('activities.experiences.sort.result', { correct: c.correct, total: c.total, defaultValue: '{{correct}} of {{total}} correct' }),
    )
    if (c.stars > best) {
      setBest(c.stars)
      memory.write('best', c.stars)
    }
  }

  const onRetryWrong = () => {
    if (!check) return
    setPlacement((p) => retryWrong(p, check))
    setCheck(null)
    setLive(t('activities.experiences.sort.retry_live', 'The wrong ones are back in the tray.'))
  }

  const onReset = () => {
    setOrder(trayOrder(data))
    setPlacement({})
    setCheck(null)
    setSelected(null)
    setLive('')
  }

  if (!isPlayable(data)) {
    return (
      <ExperienceFrame {...frame} title={data.title} instructions={data.instructions}>
        <NotReady>{t('activities.experiences.sort.not_ready', 'This activity is not ready yet.')}</NotReady>
      </ExperienceFrame>
    )
  }

  const tray = unplacedIds(order, placement)
  const placedCount = data.items.length - tray.length
  const ready = allPlaced(data, placement)
  const wrong = check ? data.items.filter((it) => check.results[it.id] === 'wrong') : []

  const chipKeyDown = (e: React.KeyboardEvent<HTMLElement>, id: string) => {
    if (check) return
    if (e.key === 'Escape') {
      setSelected(null)
      return
    }
    const n = Number(e.key)
    if (Number.isInteger(n) && n >= 1 && n <= data.categories.length) {
      e.preventDefault()
      doPlace(id, data.categories[n - 1].id)
      return
    }
    focusSibling(e, '[data-sort-chip]', rootRef.current)
  }

  const chip = (id: string, inZone: boolean) => {
    const result = check?.results[id]
    const isSel = selected === id
    return (
      <button
        key={id}
        type="button"
        data-sort-chip=""
        {...itemProps(id)}
        onClick={(e) => {
          e.stopPropagation()
          tapChip(id)
        }}
        onKeyDown={(e) => chipKeyDown(e, id)}
        aria-pressed={check ? undefined : isSel}
        aria-disabled={check ? true : undefined}
        data-result={result === 'correct' || result === 'wrong' ? result : undefined}
        className={cn(
          'lh-exp-raised inline-flex min-h-10 max-w-full min-w-0 touch-manipulation items-center gap-1.5 rounded-xl px-3 py-2 text-start text-[14px] leading-snug font-medium outline-none select-none',
          !check && 'lh-exp-press cursor-grab active:cursor-grabbing',
          isSel ? 'text-sky-700' : !result && 'text-neutral-800',
          drag?.id === id && 'opacity-40',
          inZone && !check && 'lh-exp-snap',
          result === 'wrong' && 'lh-exp-wrong-shake',
        )}
      >
        {result && result !== 'unplaced' && (
          <ResultIcon
            ok={result === 'correct'}
            size={15}
            label={result === 'correct' ? t('activities.experiences.sort.correct', 'Correct') : t('activities.experiences.sort.wrong', 'Wrong')}
          />
        )}
        <span className="pointer-events-none min-w-0 [overflow-wrap:anywhere]">{textOf(id)}</span>
      </button>
    )
  }

  const footer = (
    <ExperienceFooter
      progress={check ? undefined : { done: placedCount, total: data.items.length }}
      stars={check ? check.stars : undefined}
      score={check ? `${check.correct} / ${check.total}` : undefined}
      onRetry={check || placedCount > 0 ? onReset : undefined}
    >
      {!check && best > 0 && (
        <span className="flex items-center gap-1.5 text-xs text-neutral-500">
          {t('activities.experiences.sort.best', 'Best')}
          <Stars value={best as 0 | 1 | 2 | 3} size={13} />
        </span>
      )}
    </ExperienceFooter>
  )

  const zoneCols = data.categories.length >= 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2'

  return (
    <ExperienceFrame {...frame} title={data.title} instructions={data.instructions} footer={footer} celebrate={!!check?.perfect} live={live}>
      <div ref={rootRef} className="flex flex-col gap-4">
        {!check && (
          <p className="m-0 text-[13px] leading-snug text-neutral-500">
            {selected
              ? t('activities.experiences.sort.selected_hint', { item: textOf(selected), defaultValue: 'Now tap a group for “{{item}}”.' })
              : t('activities.experiences.sort.hint', 'Drag each item into a group, or tap an item and then a group.')}
          </p>
        )}

        {/* Tray */}
        {!check && (
          <div
            data-drop-target={TRAY}
            role="group"
            aria-label={t('activities.experiences.sort.tray_label', 'Items to sort')}
            onClick={() => selected && placement[selected] && doPlace(selected, null)}
            data-over={drag?.over === TRAY ? 'true' : undefined}
            className={cn(
              'lh-exp-well flex min-h-16 flex-wrap items-center gap-2 rounded-2xl p-3 text-neutral-400',
              selected && placement[selected] && 'cursor-pointer',
            )}
          >
            {tray.length ? (
              tray.map((id) => chip(id, false))
            ) : (
              <span className="flex items-center gap-2 text-[13px] text-neutral-500">
                <Tray size={16} aria-hidden />
                {t('activities.experiences.sort.tray_empty', 'All placed. Check your answers when you are ready.')}
              </span>
            )}
            {selected && placement[selected] && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  doPlace(selected, null)
                }}
                className="lh-exp-raised lh-exp-press ms-auto inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-medium text-neutral-700"
              >
                {t('activities.experiences.sort.back_to_tray', 'Back to the tray')}
              </button>
            )}
          </div>
        )}

        {/* Groups */}
        <div className={cn('grid grid-cols-1 gap-3', zoneCols)}>
          {data.categories.map((c, ci) => {
            const ids = order.filter((id) => placement[id] === c.id)
            const over = drag?.over === c.id
            const target = !check && !!selected && placement[selected] !== c.id
            return (
              <div
                key={c.id}
                data-drop-target={c.id}
                role="group"
                aria-label={t('activities.experiences.sort.group_label', { group: c.label, defaultValue: 'Group: {{group}}' })}
                onClick={() => target && selected && doPlace(selected, c.id)}
                data-over={over || target ? 'true' : undefined}
                className={cn('lh-exp-well lh-exp-tinted flex min-h-32 min-w-0 flex-col gap-2 rounded-2xl p-3', COLOR[c.color].zone, target && 'cursor-pointer')}
              >
                <div className="flex items-center gap-2">
                  <span aria-hidden className={cn('h-2.5 w-2.5 shrink-0 rounded-full', COLOR[c.color].dot)} />
                  <span className={cn('min-w-0 flex-1 text-[13px] font-semibold [overflow-wrap:anywhere]', COLOR[c.color].text)}>{c.label}</span>
                  {!check && (
                    <kbd aria-hidden className="lh-exp-raised hidden rounded-md px-1.5 text-[11px] font-medium text-neutral-500 sm:inline">
                      {ci + 1}
                    </kbd>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">{ids.map((id) => chip(id, true))}</div>
                {target && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      doPlace(selected, c.id)
                    }}
                    className="lh-exp-raised lh-exp-press mt-auto inline-flex min-h-10 items-center justify-center rounded-xl px-3 text-[13px] font-medium text-neutral-700 outline-none"
                  >
                    {t('activities.experiences.sort.place_here', { item: textOf(selected), defaultValue: 'Put “{{item}}” here' })}
                  </button>
                )}
                {!ids.length && !target && (
                  <span className="m-auto text-[13px] text-neutral-400">{t('activities.experiences.sort.zone_empty', 'Drop items here')}</span>
                )}
              </div>
            )
          })}
        </div>

        {/* Check / results */}
        {!check ? (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={onCheck} disabled={!ready} className="lh-exp-key">
              {t('activities.experiences.sort.check', 'Check')}
            </button>
            {!ready && (
              <span className="text-[13px] text-neutral-500">
                {t('activities.experiences.sort.place_all', 'Place every item to check.')}
              </span>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className={cn('m-0 flex items-center gap-2 text-[14px] font-medium', check.perfect ? 'text-emerald-700' : 'text-neutral-700')}>
              <ResultIcon ok={check.perfect} size={16} label="" />
              {check.perfect
                ? t('activities.experiences.sort.perfect', 'Perfect! Everything is in the right group.')
                : t('activities.experiences.sort.result', { correct: check.correct, total: check.total, defaultValue: '{{correct}} of {{total}} correct' })}
            </p>
            {wrong.length > 0 && (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {wrong.map((it) => (
                  <li key={it.id} className="rounded-xl bg-rose-50/70 px-3 py-2 text-[13px] leading-relaxed text-neutral-700">
                    <span className="font-medium text-neutral-900">
                      {t('activities.experiences.sort.belongs_in', { item: it.text, group: groupOf(it.categoryId), defaultValue: '“{{item}}” belongs in {{group}}.' })}
                    </span>
                    {it.explanation && <span className="block text-neutral-600">{it.explanation}</span>}
                  </li>
                ))}
              </ul>
            )}
            {!check.perfect && (
              <div>
                <button type="button" onClick={onRetryWrong} className="lh-exp-key">
                  <ArrowCounterClockwise size={14} weight="bold" aria-hidden />
                  {t('activities.experiences.sort.retry_wrong', 'Retry wrong ones')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {drag && <DragGhost x={drag.x} y={drag.y}>{textOf(drag.id)}</DragGhost>}
    </ExperienceFrame>
  )
}
