'use client'
/*
 "Sequence" (node expSequence): learners put steps or events in order.

 Author: edit in place on the learner's list, already in the correct order
 (the answer key). Step text and the timeline detail are edited where they
 sit; reorder by the grip (drag or arrow keys) or the up / down buttons;
 "+ Add step" and × add and remove. List / timeline lives behind the gear.

 Learner: the steps arrive shuffled. Reorder by dragging the grip (mouse,
 pen, touch), with the up / down buttons, with arrow keys on the grip, or by
 tapping a step and then tapping the place it goes. "Check" marks each step
 ✓ / ✗ and counts how many are in place; one more try is allowed, then the
 correct positions are shown. The timeline variant reveals each step's detail
 (e.g. a year) after checking.
*/
import React from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { CaretDown, CaretUp, DotsSixVertical, ListNumbers } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Segmented, SettingsField } from '../../../Blocks/ui/BlockChrome'
import { usePointerReorder, type ReorderState } from '../../../Blocks/ui/usePointerReorder'
import {
  AddGhost,
  AnswerKeyHint,
  EDIT_OBJECT,
  ExperienceFooter,
  ExperienceFrame,
  InlineText,
  RemoveX,
  SettingsGear,
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
  SEQUENCE_LIMITS,
  SEQUENCE_MAX_ATTEMPTS,
  addItem,
  checkSequence,
  correctPositions,
  initialOrder,
  isPlayable,
  moveInList,
  moveItem,
  normalizeSequence,
  playableSequence,
  removeItem,
  sequenceStars,
  updateItem,
  validateSequence,
  type SequenceCheck,
  type SequenceData,
  type SequenceVariant,
} from './sequenceModel'
import { ICON_BTN, InlineHint, NotReady, ResultIcon, contentKey } from '../Sort/kit'

/**
 How far each tile slides while one is dragged, so the others make room and
 the dragged tile sits in the slot it would drop into. Heights are read once
 when the drag starts; nothing moves in the DOM until the drop.
*/
function useSlideOffsets(listRef: React.RefObject<HTMLElement | null>, drag: ReorderState | null): { offsets: number[]; still: boolean } {
  const [steps, setSteps] = React.useState<number[] | null>(null)
  // The frame the tiles are re-ordered for real must not animate back from
  // their slid positions: transitions are off for that one frame.
  const [lastDrag, setLastDrag] = React.useState(drag)
  const [still, setStill] = React.useState(false)
  if (lastDrag !== drag) {
    setLastDrag(drag)
    if (lastDrag && !drag) setStill(true)
    if (!drag && steps) setSteps(null)
  }
  React.useEffect(() => {
    if (!still) return
    const id = requestAnimationFrame(() => setStill(false))
    return () => cancelAnimationFrame(id)
  }, [still])
  React.useLayoutEffect(() => {
    if (!drag || steps) return
    const els = Array.from(listRef.current?.querySelectorAll<HTMLElement>(':scope > [data-reorder-item]') ?? [])
    if (els.length < 2) return
    const tops = els.map((el) => el.offsetTop)
    const gap = tops[1] - tops[0] - els[0].offsetHeight
    // Each tile's step is its height plus the gap after it.
    setSteps(els.map((el, i) => (i < els.length - 1 ? tops[i + 1] - tops[i] : el.offsetHeight + gap)))
  }, [drag, steps, listRef])
  if (!drag || !steps || drag.from === drag.over) return { offsets: [], still }
  const { from, over } = drag
  const out = steps.map(() => 0)
  if (over > from) {
    for (let i = from + 1; i <= over; i++) {
      out[i] = -steps[from]
      out[from] += steps[i]
    }
  } else {
    for (let i = over; i < from; i++) {
      out[i] = steps[from]
      out[from] -= steps[i]
    }
  }
  return { offsets: out, still }
}

const TONE = 'info' as const

/** The learner's grip: a ridged, thumb-sized handle at the start of the tile. */
const TILE_GRIP =
  'flex h-10 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-neutral-400 outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-600 focus-visible:text-neutral-700 focus-visible:ring-2 focus-visible:ring-sky-500/50 active:cursor-grabbing'

type Frame = {
  tone: typeof TONE
  icon: React.ReactNode
  editable: boolean
  preview: boolean
  onPreviewChange: (_v: boolean) => void
  nodeView: NodeViewProps
  label: string
}

export default function SequenceView(props: NodeViewProps) {
  const { t } = useTranslation()
  const editable = useExperienceEditable(props)
  useEnsureBlockId(props, editable)
  const [attrs, commit] = useLiveAttrs(props)
  const data = React.useMemo(() => normalizeSequence(attrs), [attrs])
  const [preview, setPreview] = React.useState(false)
  const frame: Frame = {
    tone: TONE,
    icon: <ListNumbers weight="duotone" />,
    editable,
    preview,
    onPreviewChange: setPreview,
    nodeView: props,
    label: t('editor.experiences.sequence.title', 'Sequence'),
  }
  const playable = React.useMemo(() => playableSequence(data), [data])
  return (
    <NodeViewWrapper className="block-exp-sequence">
      {editable && !preview ? (
        <SequenceEditor data={data} commit={commit} frame={frame} />
      ) : (
        <SequencePlayer key={contentKey(playable)} data={playable} frame={frame} source={props} />
      )}
    </NodeViewWrapper>
  )
}

// ─── Author: edit in place ──────────────────────────────────────────────────
// The learner's list, already in the correct order (the answer key). Step text
// (and the timeline detail) is edited where it sits; reorder by the grip (drag
// or arrow keys) or the up / down buttons. Layout lives behind the gear.

const ISSUE_FALLBACK: Record<string, string> = {
  too_few_items: 'Add at least 3 steps.',
  too_many_items: 'Use at most 10 steps; learners only see the first 10.',
  empty_item: 'This step is empty; learners will not see it.',
  duplicate_item: 'Another step has the same text, so learners cannot tell them apart.',
  missing_detail: 'Add a detail (like a year) to reveal on the timeline.',
}

function SequenceEditor({ data, commit, frame }: { data: SequenceData; commit: (_p: CommitPatch<Record<string, any>>) => void; frame: Frame }) {
  const { t } = useTranslation()
  const issues = React.useMemo(() => validateSequence(data), [data])
  const issueText = (code: string) => t(`editor.experiences.sequence.issues.${code}`, ISSUE_FALLBACK[code] ?? code)
  const edit = (fn: (_d: SequenceData) => SequenceData) => commit((live) => ({ items: fn(normalizeSequence(live)).items }))
  const listRef = React.useRef<HTMLOListElement>(null)
  const [live, setLive] = React.useState('')
  const stepName = (i: number) => data.items[i]?.text.trim() || t('editor.experiences.sequence.step_placeholder', { n: i + 1, defaultValue: 'Step {{n}}' })
  const move = (from: number, to: number) => {
    if (from === to) return
    edit((d) => moveItem(d, from, to))
    setLive(t('activities.experiences.sequence.moved', { item: stepName(from), n: to + 1, defaultValue: '“{{item}}” moved to position {{n}}.' }))
  }
  const { drag, gripProps } = usePointerReorder({ containerRef: listRef, count: data.items.length, onMove: move })
  const { offsets: slide, still } = useSlideOffsets(listRef, drag)
  const timeline = data.variant === 'timeline'
  const canRemove = data.items.length > SEQUENCE_LIMITS.minItems

  // Focus a new or neighbouring step once it has rendered.
  const pendingFocus = React.useRef<string | null>(null)
  const tryFocus = () => {
    const sel = pendingFocus.current
    const el = sel ? listRef.current?.parentElement?.querySelector<HTMLElement>(sel) : null
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

  const moveBy = (id: string, delta: -1 | 1) => {
    const from = data.items.findIndex((it) => it.id === id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= data.items.length) return
    move(from, to)
    const other = (to === 0 && delta < 0) || (to === data.items.length - 1 && delta > 0)
    focusLater(`[data-seq-id="${id}"] [data-dir="${other ? (delta < 0 ? 'down' : 'up') : delta < 0 ? 'up' : 'down'}"]`)
  }
  const add = () => {
    const id = newId()
    edit((d) => addItem(d, id))
    focusLater(`[data-seq-id="${id}"] textarea`)
  }
  const remove = (i: number) => {
    const it = data.items[i]
    const next = data.items[i + 1] ?? data.items[i - 1]
    edit((d) => removeItem(d, it.id))
    focusLater(next ? `[data-seq-id="${next.id}"] textarea` : '[data-add-step]')
  }

  const settings = (
    <SettingsGear>
      <SettingsField
        label={t('editor.experiences.sequence.layout_label', 'Layout')}
        hint={timeline ? t('editor.experiences.sequence.timeline_hint', 'Each step’s detail (like a year) is revealed after learners check.') : undefined}
      >
        <Segmented<SequenceVariant>
          value={data.variant}
          onChange={(variant) => commit({ variant })}
          ariaLabel={t('editor.experiences.sequence.layout_label', 'Layout')}
          options={[
            { value: 'list', label: t('editor.experiences.sequence.variant_list', 'List') },
            { value: 'timeline', label: t('editor.experiences.sequence.variant_timeline', 'Timeline') },
          ]}
        />
      </SettingsField>
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
      <div className="flex flex-col gap-4">
        <p className="m-0 text-[13px] leading-snug text-neutral-500">
          {t('editor.experiences.sequence.author_hint', 'This is the correct order; learners get the steps shuffled. Drag a step or use the arrows to reorder.')}
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

        <ol
          ref={listRef}
          data-reorder-list=""
          aria-label={t('editor.experiences.sequence.items_heading', 'Steps, in the correct order')}
          className={cn('m-0 flex list-none flex-col gap-2 p-0', timeline && 'relative ps-7 before:absolute before:inset-y-3 before:start-[11px] before:w-0.5 before:rounded before:bg-blue-100')}
        >
          {data.items.map((it, i) => {
            const dragging = drag?.from === i
            const offset = slide[i] ?? 0
            const name = stepName(i)
            const rowIssues = issues.filter((x) => x.id === it.id)
            return (
              <li
                key={it.id}
                data-reorder-item=""
                data-seq-id={it.id}
                data-picked={dragging ? 'true' : undefined}
                style={
                  {
                    ...(drag ? { transform: `translateY(${offset - (dragging ? 3 : 0)}px)`, zIndex: dragging ? 2 : undefined } : null),
                    ...(still ? { transition: 'none' } : null),
                  } as React.CSSProperties
                }
                className={cn(
                  'lh-exp-raised relative flex min-h-12 min-w-0 items-center gap-1.5 rounded-xl py-1 ps-1 pe-1.5',
                  EDIT_OBJECT,
                  dragging ? 'text-sky-700' : 'text-neutral-800',
                  drag && 'lh-exp-slide',
                )}
              >
                {timeline && <span aria-hidden className="absolute -start-[22px] top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-blue-400 ring-2 ring-white" />}
                <button
                  type="button"
                  {...gripProps(i, it.id)}
                  className={TILE_GRIP}
                  aria-label={t('editor.experiences.sequence.drag_step', { n: i + 1, defaultValue: 'Move step {{n}} (drag or arrow keys)' })}
                  title={t('editor.experiences.sequence.drag_short', 'Drag to reorder')}
                >
                  <DotsSixVertical size={16} weight="bold" aria-hidden className="pointer-events-none" />
                </button>
                <span aria-hidden className="lh-exp-well inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums text-neutral-600">
                  {i + 1}
                </span>
                <div className="flex min-h-10 min-w-0 flex-1 flex-col items-start justify-center gap-0.5 px-1.5 py-1">
                  <InlineText
                    value={it.text}
                    onCommit={(text) => edit((d) => updateItem(d, it.id, { text }))}
                    ariaLabel={t('editor.experiences.sequence.step_placeholder', { n: i + 1, defaultValue: 'Step {{n}}' })}
                    placeholder={t('editor.experiences.sequence.step_placeholder', { n: i + 1, defaultValue: 'Step {{n}}' })}
                    maxLength={160}
                    className="w-full text-[14px] leading-snug font-medium [overflow-wrap:anywhere]"
                  />
                  {timeline && (
                    <InlineText
                      fit
                      value={it.detail ?? ''}
                      onCommit={(detail) => edit((d) => updateItem(d, it.id, { detail }))}
                      ariaLabel={t('editor.experiences.sequence.detail_label_n', { n: i + 1, defaultValue: 'Step {{n}} detail' })}
                      placeholder={t('editor.experiences.sequence.detail_placeholder', 'Detail, e.g. 1969')}
                      maxLength={40}
                      className="rounded-md bg-blue-50 px-1.5 py-px text-[12px] font-semibold tabular-nums text-blue-700"
                    />
                  )}
                  {rowIssues.map((x) => (
                    <InlineHint key={x.code} severity={x.severity}>
                      {issueText(x.code)}
                    </InlineHint>
                  ))}
                </div>
                <span className="flex shrink-0 items-center">
                  <button
                    type="button"
                    data-dir="up"
                    disabled={i === 0}
                    onClick={() => moveBy(it.id, -1)}
                    className={cn(ICON_BTN, 'h-8 w-8')}
                    aria-label={t('activities.experiences.sequence.move_up', { item: name, defaultValue: 'Move “{{item}}” up' })}
                  >
                    <CaretUp size={15} weight="bold" aria-hidden className="pointer-events-none" />
                  </button>
                  <button
                    type="button"
                    data-dir="down"
                    disabled={i === data.items.length - 1}
                    onClick={() => moveBy(it.id, 1)}
                    className={cn(ICON_BTN, 'h-8 w-8')}
                    aria-label={t('activities.experiences.sequence.move_down', { item: name, defaultValue: 'Move “{{item}}” down' })}
                  >
                    <CaretDown size={15} weight="bold" aria-hidden className="pointer-events-none" />
                  </button>
                </span>
                <RemoveX floating disabled={!canRemove} onClick={() => remove(i)} label={t('editor.experiences.sequence.remove_named', { item: name, defaultValue: 'Remove “{{item}}”' })} />
              </li>
            )
          })}
        </ol>
        {data.items.length < SEQUENCE_LIMITS.maxItems && (
          <AddGhost data-add-step="" onClick={add} className={cn('min-h-12 w-full rounded-xl px-3 text-[14px]', timeline && 'ms-7 w-[calc(100%-1.75rem)]')}>
            {t('editor.experiences.sequence.add_step', 'Add step')}
          </AddGhost>
        )}
      </div>
    </ExperienceFrame>
  )
}

// ─── Learner ────────────────────────────────────────────────────────────────

function SequencePlayer({ data, frame, source }: { data: SequenceData; frame: Frame; source: NodeViewProps }) {
  const { t } = useTranslation()
  const memory = useExperienceMemory(data.blockId, source)
  const [order, setOrder] = React.useState(() => initialOrder(data))
  const [attempt, setAttempt] = React.useState(1)
  const [check, setCheck] = React.useState<SequenceCheck | null>(null)
  const [selected, setSelected] = React.useState<string | null>(null)
  const [live, setLive] = React.useState('')
  const [best, setBest] = React.useState<number>(() => memory.read<number>('best', 0))
  const listRef = React.useRef<HTMLOListElement>(null)

  const byId = React.useMemo(() => new Map(data.items.map((it) => [it.id, it])), [data])
  const positions = React.useMemo(() => correctPositions(data), [data])
  const textOf = (id: string) => byId.get(id)?.text ?? ''
  const final = !!check && (check.perfect || attempt >= SEQUENCE_MAX_ATTEMPTS)
  const stars = check && final ? sequenceStars(check, attempt) : undefined
  const timeline = data.variant === 'timeline'

  const move = (from: number, to: number) => {
    if (check) return
    const id = order[from]
    setOrder((o) => moveInList(o, from, to))
    setSelected(null)
    setLive(t('activities.experiences.sequence.moved', { item: textOf(id), n: to + 1, defaultValue: '“{{item}}” moved to position {{n}}.' }))
  }

  const { drag, gripProps } = usePointerReorder({ containerRef: listRef, count: order.length, onMove: move })
  const { offsets: slide, still } = useSlideOffsets(listRef, drag)

  // Keep focus on the arrow button after its row moved (or on its sibling at an edge).
  const moveBy = (id: string, delta: -1 | 1) => {
    const from = order.indexOf(id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= order.length) return
    move(from, to)
    requestAnimationFrame(() => {
      const row = listRef.current?.querySelector<HTMLElement>(`[data-seq-id="${CSS.escape(id)}"]`)
      const want = row?.querySelector<HTMLButtonElement>(`[data-dir="${delta < 0 ? 'up' : 'down'}"]`)
      const other = row?.querySelector<HTMLButtonElement>(`[data-dir="${delta < 0 ? 'down' : 'up'}"]`)
      ;(want && !want.disabled ? want : other)?.focus()
    })
  }

  const tapRow = (id: string) => {
    if (check) return
    if (!selected) {
      setSelected(id)
      setLive(t('activities.experiences.sequence.selected', { item: textOf(id), defaultValue: 'Selected “{{item}}”. Now tap the place where it goes.' }))
      return
    }
    if (selected === id) {
      setSelected(null)
      return
    }
    move(order.indexOf(selected), order.indexOf(id))
  }

  const onCheck = () => {
    const c = checkSequence(data, order)
    setCheck(c)
    buzz(c.perfect ? 'correct' : 'wrong')
    setSelected(null)
    const isFinal = c.perfect || attempt >= SEQUENCE_MAX_ATTEMPTS
    const msg = c.perfect
      ? t('activities.experiences.sequence.perfect', 'Perfect order!')
      : t('activities.experiences.sequence.result', { done: c.inPlace, total: c.total, defaultValue: '{{done}} of {{total}} in the right place' })
    setLive(isFinal && !c.perfect ? `${msg} ${t('activities.experiences.sequence.answer_shown', 'The correct positions are shown.')}` : msg)
    if (isFinal) {
      const s = sequenceStars(c, attempt)
      if (s > best) {
        setBest(s)
        memory.write('best', s)
      }
    }
  }

  const onSecondTry = () => {
    setCheck(null)
    setAttempt((a) => a + 1)
    setLive(t('activities.experiences.sequence.second_try_hint', 'Fix the steps marked wrong, then check again.'))
  }

  const onReset = () => {
    setOrder(initialOrder(data))
    setAttempt(1)
    setCheck(null)
    setSelected(null)
    setLive('')
  }

  if (!isPlayable(data)) {
    return (
      <ExperienceFrame {...frame} title={data.title} instructions={data.instructions}>
        <NotReady>{t('activities.experiences.sequence.not_ready', 'This activity is not ready yet.')}</NotReady>
      </ExperienceFrame>
    )
  }

  const footer = (
    <ExperienceFooter
      stars={stars}
      score={check ? `${check.inPlace} / ${check.total}` : undefined}
      onRetry={final ? onReset : undefined}
    >
      {!check && (
        <span className="text-xs font-medium tabular-nums text-neutral-500">
          {t('activities.experiences.sequence.attempt', { n: attempt, max: SEQUENCE_MAX_ATTEMPTS, defaultValue: 'Try {{n}} of {{max}}' })}
        </span>
      )}
      {!check && best > 0 && (
        <span className="flex items-center gap-1.5 text-xs text-neutral-500">
          {t('activities.experiences.sequence.best', 'Best')}
          <Stars value={best as 0 | 1 | 2 | 3} size={13} />
        </span>
      )}
    </ExperienceFooter>
  )

  return (
    <ExperienceFrame {...frame} title={data.title} instructions={data.instructions} footer={footer} celebrate={!!check?.perfect && stars === 3} live={live}>
      <div className="flex flex-col gap-4">
        {!check && (
          <p className="m-0 text-[13px] leading-snug text-neutral-500">
            {selected
              ? t('activities.experiences.sequence.selected_hint', { item: textOf(selected), defaultValue: 'Tap the step whose place “{{item}}” should take.' })
              : t('activities.experiences.sequence.hint', 'Drag the steps into order or use the arrows. You can also tap a step, then tap where it goes.')}
          </p>
        )}

        <ol
          ref={listRef}
          data-reorder-list=""
          aria-label={t('activities.experiences.sequence.list_label', 'Steps to put in order')}
          className={cn('m-0 flex list-none flex-col gap-2 p-0', timeline && 'relative ps-7 before:absolute before:inset-y-3 before:start-[11px] before:w-0.5 before:rounded before:bg-blue-100')}
        >
          {order.map((id, i) => {
            const ok = check ? check.positions[id] : undefined
            const it = byId.get(id)
            const isSel = selected === id
            const dragging = drag?.from === i
            const offset = slide[i] ?? 0
            return (
              <li
                key={id}
                data-reorder-item=""
                data-seq-id={id}
                data-picked={dragging || isSel ? 'true' : undefined}
                data-result={ok === true ? 'correct' : ok === false ? 'wrong' : undefined}
                style={
                  {
                    '--exp-i': i,
                    ...(drag ? { transform: `translateY(${offset - (dragging ? 3 : 0)}px)`, zIndex: dragging ? 2 : undefined } : null),
                    ...(still ? { transition: 'none' } : null),
                  } as React.CSSProperties
                }
                className={cn(
                  'lh-exp-raised relative flex min-h-12 min-w-0 items-center gap-1.5 rounded-xl py-1 ps-1 pe-1.5',
                  ok === undefined && (isSel || dragging ? 'text-sky-700' : 'text-neutral-800'),
                  drag && 'lh-exp-slide',
                  ok === true && 'lh-exp-settle',
                  ok === false && 'lh-exp-wrong-shake',
                )}
              >
                {timeline && (
                  <span
                    aria-hidden
                    className={cn(
                      'absolute -start-[22px] top-1/2 h-3 w-3 -translate-y-1/2 rounded-full ring-2 ring-white',
                      ok === true ? 'bg-emerald-500' : ok === false ? 'bg-rose-500' : 'bg-blue-400',
                    )}
                  />
                )}
                {!check && (
                  <button
                    type="button"
                    {...gripProps(i, id)}
                    className={TILE_GRIP}
                    aria-label={t('activities.experiences.sequence.grip', { item: it?.text ?? '', defaultValue: 'Move “{{item}}” (drag or arrow keys)' })}
                  >
                    <DotsSixVertical size={16} weight="bold" aria-hidden className="pointer-events-none" />
                  </button>
                )}
                <span
                  aria-hidden
                  className={cn(
                    'lh-exp-well inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums text-neutral-600',
                    check && 'ms-2',
                  )}
                >
                  {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => tapRow(id)}
                  disabled={!!check}
                  aria-pressed={check ? undefined : isSel}
                  aria-label={`${t('activities.experiences.sequence.position', { n: i + 1, defaultValue: 'Position {{n}}' })}: ${it?.text ?? ''}`}
                  className="flex min-h-10 min-w-0 flex-1 touch-manipulation flex-col items-start justify-center gap-0.5 rounded-lg px-1.5 py-1 text-start text-[14px] leading-snug font-medium text-inherit outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50 disabled:cursor-default"
                >
                  <span className="pointer-events-none [overflow-wrap:anywhere]">{it?.text}</span>
                  {timeline && check && it?.detail && (
                    <span className="pointer-events-none rounded-md bg-blue-50 px-1.5 py-px text-[12px] font-semibold tabular-nums text-blue-700">{it.detail}</span>
                  )}
                  {final && ok === false && (
                    <span className="pointer-events-none text-[12px] font-medium text-rose-700">
                      {t('activities.experiences.sequence.goes_at', { n: positions[id], defaultValue: 'Goes at #{{n}}' })}
                    </span>
                  )}
                </button>
                {ok !== undefined && (
                  <ResultIcon
                    ok={ok}
                    size={17}
                    label={ok ? t('activities.experiences.sequence.in_place', 'In the right place') : t('activities.experiences.sequence.out_of_place', 'Not in the right place')}
                  />
                )}
                {!check && (
                  <span className="flex shrink-0 items-center">
                    <button
                      type="button"
                      data-dir="up"
                      disabled={i === 0}
                      onClick={() => moveBy(id, -1)}
                      className={cn(ICON_BTN, 'h-8 w-8')}
                      aria-label={t('activities.experiences.sequence.move_up', { item: it?.text ?? '', defaultValue: 'Move “{{item}}” up' })}
                    >
                      <CaretUp size={15} weight="bold" aria-hidden className="pointer-events-none" />
                    </button>
                    <button
                      type="button"
                      data-dir="down"
                      disabled={i === order.length - 1}
                      onClick={() => moveBy(id, 1)}
                      className={cn(ICON_BTN, 'h-8 w-8')}
                      aria-label={t('activities.experiences.sequence.move_down', { item: it?.text ?? '', defaultValue: 'Move “{{item}}” down' })}
                    >
                      <CaretDown size={15} weight="bold" aria-hidden className="pointer-events-none" />
                    </button>
                  </span>
                )}
              </li>
            )
          })}
        </ol>

        {!check ? (
          <div>
            <button type="button" onClick={onCheck} className="lh-exp-key">
              {t('activities.experiences.sequence.check', 'Check order')}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className={cn('m-0 flex items-center gap-2 text-[14px] font-medium', check.perfect ? 'text-emerald-700' : 'text-neutral-700')}>
              <ResultIcon ok={check.perfect} size={16} label="" />
              {check.perfect
                ? t('activities.experiences.sequence.perfect', 'Perfect order!')
                : t('activities.experiences.sequence.result', { done: check.inPlace, total: check.total, defaultValue: '{{done}} of {{total}} in the right place' })}
            </p>
            {!final && (
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={onSecondTry} className="lh-exp-key">
                  {t('activities.experiences.sequence.second_try', 'Try once more')}
                </button>
                <span className="text-[13px] text-neutral-500">
                  {t('activities.experiences.sequence.second_try_hint', 'Fix the steps marked wrong, then check again.')}
                </span>
              </div>
            )}
            {final && !check.perfect && (
              <p className="m-0 text-[13px] text-neutral-500">{t('activities.experiences.sequence.answer_shown', 'The correct positions are shown.')}</p>
            )}
          </div>
        )}
      </div>
    </ExperienceFrame>
  )
}
