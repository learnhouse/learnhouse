'use client'
/*
 "Sort it" (node expSort): learners put item chips into the right group.

 Author: edit in place on the learner's layout. Every chip already sits in
 its correct group (the answer key); group names and chip text are edited
 where they are, "+ Add item" / "+ Add group" ghosts add, × removes, and a
 chip moves by drag or by tapping its handle and then a group. "Why?" on a
 chip opens its explanation. Shuffle lives behind the header gear.

 Learner: chips in a tray; drag one onto a group (mouse, pen, touch
 press-and-hold) or tap a chip, then tap a group. Keyboard: Tab to a chip,
 Enter / Space selects it, 1–4 drops it straight into that group, arrow keys
 move between chips, Escape clears the selection. "Check" marks every chip
 ✓ / ✗ with an explanation for the wrong ones; "Retry wrong ones" sends only
 those back to the tray.
*/
import React from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { ArrowCounterClockwise, DotsSixVertical, Stack, Tray } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  AddGhost,
  AnswerKeyHint,
  EDIT_OBJECT,
  ExperienceFooter,
  ExperienceFrame,
  InlineText,
  RemoveX,
  SettingsGear,
  SettingsToggle,
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
  type SortCategory,
  type SortCheck,
  type SortColor,
  type SortItem,
  type SortData,
  type SortPlacement,
} from './sortModel'
import { DragGhost, InlineHint, NotReady, ResultIcon, contentKey } from './kit'
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
        <SortAuthor data={data} commit={commit} frame={frame} />
      ) : (
        <SortPlayer key={contentKey(playable)} data={playable} frame={frame} source={props} />
      )}
    </NodeViewWrapper>
  )
}

// ─── Author: edit in place ──────────────────────────────────────────────────
// The learner's layout with every chip already in its correct group (the
// answer key). Text is edited where it sits; chips move by drag or by tapping
// their handle and then a group (keys 1–4 on a focused handle move it too).

function SortAuthor({ data, commit, frame }: { data: SortData; commit: (_p: CommitPatch<Record<string, any>>) => void; frame: Frame }) {
  const { t } = useTranslation()
  const issues = React.useMemo(() => validateSort(data), [data])
  const edit = (fn: (_d: SortData) => SortData) =>
    commit((live) => {
      const next = fn(normalizeSort(live))
      return { categories: next.categories, items: next.items }
    })
  const issueText = (code: string) => t(`editor.experiences.sort.issues.${code}`, ISSUE_FALLBACK[code] ?? code)
  const [selected, setSelected] = React.useState<string | null>(null)
  const [why, setWhy] = React.useState<string | null>(null)
  const [live, setLive] = React.useState('')
  const rootRef = React.useRef<HTMLDivElement>(null)

  // Focus moves to a new or neighbouring object once it has rendered.
  const pendingFocus = React.useRef<string | null>(null)
  const tryFocus = () => {
    const sel = pendingFocus.current
    const el = sel ? rootRef.current?.querySelector<HTMLElement>(sel) : null
    if (el) {
      pendingFocus.current = null
      el.focus()
    }
  }
  React.useEffect(tryFocus)
  const focusLater = (selector: string) => {
    pendingFocus.current = selector
    requestAnimationFrame(tryFocus)
  }

  const catIds = new Set(data.categories.map((c) => c.id))
  const itemIndex = new Map(data.items.map((it, i) => [it.id, i]))
  const itemName = (it: SortItem) =>
    it.text.trim() || t('editor.experiences.sort.item_placeholder', { n: (itemIndex.get(it.id) ?? 0) + 1, defaultValue: 'Item {{n}}' })
  const groupName = (c: SortCategory) =>
    c.label.trim() || t('editor.experiences.sort.group_placeholder', { n: data.categories.indexOf(c) + 1, defaultValue: 'Group {{n}}' })
  const canRemoveCat = data.categories.length > SORT_LIMITS.minCategories
  const canRemoveItem = data.items.length > SORT_LIMITS.minItems
  const canAddItem = data.items.length < SORT_LIMITS.maxItems

  const move = (itemId: string, categoryId: string) => {
    const it = data.items.find((x) => x.id === itemId)
    const c = data.categories.find((x) => x.id === categoryId)
    setSelected(null)
    if (!it || !c) return
    if (it.categoryId !== categoryId) edit((d) => updateItem(d, itemId, { categoryId }))
    setLive(t('editor.experiences.sort.moved', { item: itemName(it), group: groupName(c), defaultValue: 'Moved “{{item}}” to {{group}}.' }))
    focusLater(`[data-chip-id="${itemId}"] [data-grip]`)
  }
  const { drag, itemProps } = useTapDrag({ onDrop: (id, target) => catIds.has(target) && move(id, target) })

  const addItemTo = (categoryId: string) => {
    const id = newId()
    edit((d) => addItem(d, id, categoryId))
    focusLater(`[data-chip-id="${id}"] textarea`)
  }
  const removeItemAt = (it: SortItem) => {
    const siblings = data.items.filter((x) => x.categoryId === it.categoryId)
    const i = siblings.indexOf(it)
    const next = siblings[i + 1] ?? siblings[i - 1]
    edit((d) => removeItem(d, it.id))
    if (why === it.id) setWhy(null)
    if (selected === it.id) setSelected(null)
    focusLater(next ? `[data-chip-id="${next.id}"] [data-grip]` : `[data-add-item="${it.categoryId}"]`)
  }
  const addGroup = () => {
    const id = newId()
    edit((d) => addCategory(d, id))
    focusLater(`[data-group-id="${id}"] textarea`)
  }
  const removeGroup = (c: SortCategory) => {
    const rest = data.categories.filter((x) => x.id !== c.id)
    edit((d) => removeCategory(d, c.id))
    focusLater(rest[0] ? `[data-group-id="${rest[0].id}"] textarea` : '[data-add-group]')
  }

  const gripKeyDown = (e: React.KeyboardEvent<HTMLElement>, it: SortItem) => {
    if (e.key === 'Escape') {
      setSelected(null)
      return
    }
    const n = Number(e.key)
    if (Number.isInteger(n) && n >= 1 && n <= data.categories.length) {
      e.preventDefault()
      move(it.id, data.categories[n - 1].id)
      return
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && canRemoveItem) {
      e.preventDefault()
      removeItemAt(it)
      return
    }
    focusSibling(e, '[data-grip]', rootRef.current)
  }

  const chip = (it: SortItem) => {
    const dp = itemProps(it.id)
    const isSel = selected === it.id
    const name = itemName(it)
    const hasWhy = !!it.explanation?.trim()
    const n = (itemIndex.get(it.id) ?? 0) + 1
    return (
      <React.Fragment key={it.id}>
        <div
          {...dp}
          data-sort-chip=""
          data-chip-id={it.id}
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('textarea,[data-no-drag]')) return
            dp.onPointerDown(e)
          }}
          data-picked={isSel ? 'true' : undefined}
          className={cn(
            'lh-exp-raised relative inline-flex min-h-10 max-w-full min-w-0 cursor-grab touch-manipulation items-center rounded-xl px-3 py-2 text-start text-[14px] leading-snug font-medium select-none active:cursor-grabbing',
            EDIT_OBJECT,
            isSel ? 'text-sky-700' : 'text-neutral-800',
            drag?.id === it.id && 'opacity-40',
          )}
        >
          <button
            type="button"
            data-grip=""
            aria-pressed={isSel}
            aria-label={t('editor.experiences.sort.move_item', { item: name, defaultValue: 'Move “{{item}}”' })}
            title={t('editor.experiences.sort.move_hint', 'Drag to another group, or press 1–4')}
            onClick={(e) => {
              e.stopPropagation()
              setSelected(isSel ? null : it.id)
            }}
            onKeyDown={(e) => gripKeyDown(e, it)}
            data-on={isSel ? 'true' : undefined}
            className="lh-exp-tool absolute inset-y-0 start-0 inline-flex w-3 cursor-grab items-center justify-center rounded-s-xl text-neutral-300 outline-none hover:text-neutral-500"
          >
            <DotsSixVertical size={12} weight="bold" aria-hidden />
          </button>
          <InlineText
            fit
            value={it.text}
            onCommit={(text) => edit((d) => updateItem(d, it.id, { text }))}
            ariaLabel={t('editor.experiences.sort.item_label', { n, defaultValue: 'Item {{n}}' })}
            placeholder={t('editor.experiences.sort.item_placeholder', { n, defaultValue: 'Item {{n}}' })}
            maxLength={120}
          />
          <button
            type="button"
            data-no-drag=""
            aria-expanded={why === it.id}
            aria-label={t('editor.experiences.sort.why_label', { item: name, defaultValue: 'Why “{{item}}” belongs here' })}
            title={t('editor.experiences.sort.why_label', { item: name, defaultValue: 'Why “{{item}}” belongs here' })}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              setWhy(why === it.id ? null : it.id)
            }}
            data-on={hasWhy || why === it.id ? 'true' : undefined}
            className={cn(
              'lh-exp-tool lh-exp-raised absolute -end-2 -bottom-2 z-10 inline-flex h-5 items-center rounded-full px-1.5 text-[10px] leading-none font-semibold outline-none',
              hasWhy ? 'text-amber-700' : 'text-neutral-400 hover:text-neutral-700',
            )}
          >
            {t('editor.experiences.sort.why', 'Why?')}
          </button>
          <RemoveX
            floating
            disabled={!canRemoveItem}
            onClick={() => removeItemAt(it)}
            label={t('editor.experiences.sort.remove_named', { item: name, defaultValue: 'Remove “{{item}}”' })}
          />
        </div>
        {why === it.id && (
          <div className="basis-full rounded-xl bg-[color-mix(in_srgb,var(--exp-paper)_80%,transparent)] px-3 py-2 shadow-[inset_0_0_0_1px_var(--exp-edge)]">
            <span className="mb-0.5 block text-[11px] font-semibold text-neutral-400">
              {t('editor.experiences.sort.why_heading', { item: name, defaultValue: 'Why “{{item}}” belongs here (shown when a learner gets it wrong)' })}
            </span>
            <InlineText
              multiline
              autoFocus
              value={it.explanation ?? ''}
              onCommit={(explanation) => edit((d) => updateItem(d, it.id, { explanation }))}
              ariaLabel={t('editor.experiences.sort.explanation_label', 'Explanation')}
              placeholder={t('editor.experiences.sort.explanation_placeholder', 'Why it belongs there (shown when wrong, optional)')}
              maxLength={300}
              className="text-[13px] leading-relaxed text-neutral-600"
            />
          </div>
        )}
      </React.Fragment>
    )
  }

  const hintsFor = (ids: string[]) =>
    issues
      .filter((i) => i.id && ids.includes(i.id))
      .map((i) => {
        const it = data.items.find((x) => x.id === i.id)
        return (
          <InlineHint key={`${i.id}:${i.code}`} severity={i.severity}>
            {it ? `${itemName(it)}: ${issueText(i.code)}` : issueText(i.code)}
          </InlineHint>
        )
      })

  const orphans = data.items.filter((it) => !catIds.has(it.categoryId))
  const sel = selected ? data.items.find((x) => x.id === selected) : undefined
  const zoneCols = data.categories.length >= 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2'
  const settings = (
    <SettingsGear>
      <SettingsToggle
        checked={data.shuffle}
        onChange={(shuffle) => commit({ shuffle })}
        label={t('editor.experiences.sort.shuffle_label', 'Shuffle items for learners')}
        hint={t('editor.experiences.sort.shuffle_hint', 'Off: learners get the items in the order you added them.')}
      />
    </SettingsGear>
  )

  return (
    <ExperienceFrame
      {...frame}
      wysiwyg
      title={data.title}
      onTitleChange={(title) => commit({ title })}
      instructions={data.instructions}
      onInstructionsChange={(instructions) => commit({ instructions })}
      headerEnd={settings}
      footer={<AnswerKeyHint />}
      live={live}
    >
      <div ref={rootRef} className="flex flex-col gap-4">
        <p className="m-0 text-[13px] leading-snug text-neutral-500">
          {sel
            ? t('editor.experiences.sort.author_selected', { item: itemName(sel), defaultValue: 'Now tap the group “{{item}}” belongs in.' })
            : t('editor.experiences.sort.author_hint', 'Each item sits in its correct group. Drag an item, or tap its handle and then a group, to move it.')}
        </p>
        {issues.some((i) => !i.id) && (
          <div className="flex flex-col gap-1">
            {issues
              .filter((i) => !i.id)
              .map((i) => (
                <InlineHint key={i.code} severity={i.severity}>
                  {issueText(i.code)}
                </InlineHint>
              ))}
          </div>
        )}

        {/* Items whose group is gone: the learner's tray, until each is placed. */}
        {orphans.length > 0 && (
          <div role="group" aria-label={t('editor.experiences.sort.unplaced', 'Not in a group yet')} className="lh-exp-well flex min-h-16 flex-wrap items-center gap-2 rounded-2xl p-3">
            <span className="basis-full text-[12px] font-medium text-amber-700">{t('editor.experiences.sort.unplaced', 'Not in a group yet')}</span>
            {orphans.map(chip)}
          </div>
        )}

        <div className={cn('grid grid-cols-1 gap-3', zoneCols)}>
          {data.categories.map((c, ci) => {
            const items = data.items.filter((it) => it.categoryId === c.id)
            const target = !!sel && sel.categoryId !== c.id
            return (
              <div
                key={c.id}
                data-group-id={c.id}
                data-drop-target={c.id}
                role="group"
                aria-label={t('activities.experiences.sort.group_label', { group: groupName(c), defaultValue: 'Group: {{group}}' })}
                onClick={(e) => {
                  if (!target || !sel || (e.target as HTMLElement).closest('textarea,button,[data-sort-chip]')) return
                  move(sel.id, c.id)
                }}
                data-over={drag?.over === c.id || target ? 'true' : undefined}
                className={cn('lh-exp-well lh-exp-tinted relative flex min-h-32 min-w-0 flex-col gap-2 rounded-2xl p-3', EDIT_OBJECT, COLOR[c.color].zone, target && 'cursor-pointer')}
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    data-no-drag=""
                    onClick={() => edit((d) => updateCategory(d, c.id, { color: SORT_COLORS[(SORT_COLORS.indexOf(c.color) + 1) % SORT_COLORS.length] }))}
                    aria-label={t('editor.experiences.sort.change_color', 'Change colour')}
                    title={t('editor.experiences.sort.change_color', 'Change colour')}
                    className="-m-1 inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full outline-none hover:bg-white/70 focus-visible:ring-2 focus-visible:ring-sky-500/40"
                  >
                    <span aria-hidden className={cn('h-2.5 w-2.5 rounded-full', COLOR[c.color].dot)} />
                  </button>
                  <InlineText
                    value={c.label}
                    onCommit={(label) => edit((d) => updateCategory(d, c.id, { label }))}
                    ariaLabel={t('editor.experiences.sort.group_label', { n: ci + 1, defaultValue: 'Group {{n}} name' })}
                    placeholder={t('editor.experiences.sort.group_placeholder', { n: ci + 1, defaultValue: 'Group {{n}}' })}
                    maxLength={60}
                    className={cn('min-w-0 flex-1 text-[13px] font-semibold', COLOR[c.color].text)}
                  />
                  <kbd aria-hidden className="lh-exp-raised hidden rounded-md px-1.5 text-[11px] font-medium text-neutral-500 sm:inline">
                    {ci + 1}
                  </kbd>
                </div>
                <div className="flex flex-wrap gap-2">
                  {items.map(chip)}
                  {canAddItem && (
                    <AddGhost data-add-item={c.id} onClick={() => addItemTo(c.id)} className="min-h-10 rounded-xl px-3">
                      {t('editor.experiences.sort.add_item', 'Add item')}
                    </AddGhost>
                  )}
                </div>
                {target && sel && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      move(sel.id, c.id)
                    }}
                    className="lh-exp-raised lh-exp-press mt-auto inline-flex min-h-10 items-center justify-center rounded-xl px-3 text-[13px] font-medium text-neutral-700 outline-none"
                  >
                    {t('activities.experiences.sort.place_here', { item: itemName(sel), defaultValue: 'Put “{{item}}” here' })}
                  </button>
                )}
                {hintsFor([c.id, ...items.map((it) => it.id)])}
                <RemoveX
                  floating
                  disabled={!canRemoveCat}
                  onClick={() => removeGroup(c)}
                  label={t('editor.experiences.sort.remove_group_named', { group: groupName(c), defaultValue: 'Remove group “{{group}}”' })}
                />
              </div>
            )
          })}
          {data.categories.length < SORT_LIMITS.maxCategories && (
            <AddGhost data-add-group="" onClick={addGroup} className="col-span-full min-h-11 rounded-2xl px-3">
              {t('editor.experiences.sort.add_group', 'Add group')}
            </AddGhost>
          )}
        </div>
        {orphans.length > 0 && hintsFor(orphans.map((it) => it.id))}
      </div>
      {drag && <DragGhost x={drag.x} y={drag.y}>{itemName(data.items.find((x) => x.id === drag.id) ?? { id: '', text: '', categoryId: '' })}</DragGhost>}
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
