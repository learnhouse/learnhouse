'use client'
/*
 "Sequence" (node expSequence): learners put steps or events in order.

 Author: steps written in the correct order (drag the grip or use the arrow
 keys on it to reorder), an optional detail per step for the timeline
 variant, inline hints, and "Preview as learner" in the frame header.

 Learner: the steps arrive shuffled. Reorder by dragging the grip (mouse,
 pen, touch), with the up / down buttons, with arrow keys on the grip, or by
 tapping a step and then tapping the place it goes. "Check" marks each step
 ✓ / ✗ and counts how many are in place; one more try is allowed, then the
 correct positions are shown. The timeline variant reveals each step's detail
 (e.g. a year) after checking.
*/
import React from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { CaretDown, CaretUp, DotsSixVertical, ListNumbers, Trash } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import { cn } from '@/lib/utils'
import { CommitInput, FIELD_CLASS, Segmented } from '../../../Blocks/ui/BlockChrome'
import { dropEdge, usePointerReorder } from '../../../Blocks/ui/usePointerReorder'
import {
  ExperienceFooter,
  ExperienceFrame,
  Stars,
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
import { AddRowButton, BlockHints, FormSection, ICON_BTN, NotReady, RESULT_CLASS, ResultIcon, RowHints, contentKey } from '../Sort/kit'

const TONE = 'info' as const

const GRIP =
  'flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-neutral-300 outline-none transition-colors hover:text-neutral-500 focus-visible:text-neutral-600 focus-visible:ring-2 focus-visible:ring-sky-500/50 active:cursor-grabbing'

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

// ─── Author form ────────────────────────────────────────────────────────────

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
  const listRef = React.useRef<HTMLDivElement>(null)
  const { drag, gripProps } = usePointerReorder({ containerRef: listRef, count: data.items.length, onMove: (from, to) => edit((d) => moveItem(d, from, to)) })
  const timeline = data.variant === 'timeline'
  const canRemove = data.items.length > SEQUENCE_LIMITS.minItems

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

        <FormSection title={t('editor.experiences.sequence.layout_label', 'Layout')}>
          <Segmented<SequenceVariant>
            value={data.variant}
            onChange={(variant) => commit({ variant })}
            ariaLabel={t('editor.experiences.sequence.layout_label', 'Layout')}
            options={[
              { value: 'list', label: t('editor.experiences.sequence.variant_list', 'List') },
              { value: 'timeline', label: t('editor.experiences.sequence.variant_timeline', 'Timeline') },
            ]}
          />
          {timeline && (
            <p className="m-0 text-[12px] leading-snug text-neutral-400">
              {t('editor.experiences.sequence.timeline_hint', 'Each step’s detail (like a year) is revealed after learners check.')}
            </p>
          )}
        </FormSection>

        <FormSection
          title={t('editor.experiences.sequence.items_heading', 'Steps, in the correct order')}
          hint={t('editor.experiences.sequence.items_hint', 'Learners get them shuffled.')}
        >
          <div ref={listRef} data-reorder-list="" className="flex flex-col gap-2">
            {data.items.map((it, i) => {
              const edge = dropEdge(drag, i)
              return (
                <div
                  key={it.id}
                  data-reorder-item=""
                  className={cn(
                    'relative flex flex-col gap-1 rounded-xl bg-neutral-50/80 p-2 ring-1 ring-neutral-100',
                    drag?.from === i && 'opacity-50',
                    edge === 'before' && 'before:absolute before:inset-x-2 before:-top-1.5 before:h-0.5 before:rounded before:bg-blue-500',
                    edge === 'after' && 'after:absolute after:inset-x-2 after:-bottom-1.5 after:h-0.5 after:rounded after:bg-blue-500',
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      {...gripProps(i, it.id)}
                      className={GRIP}
                      aria-label={t('editor.experiences.sequence.drag_step', { n: i + 1, defaultValue: 'Move step {{n}} (drag or arrow keys)' })}
                      title={t('editor.experiences.sequence.drag_short', 'Drag to reorder')}
                    >
                      <DotsSixVertical size={14} weight="bold" aria-hidden className="pointer-events-none" />
                    </button>
                    <span aria-hidden className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[11px] font-semibold tabular-nums text-blue-700">
                      {i + 1}
                    </span>
                    <CommitInput
                      value={it.text}
                      onCommit={(text) => edit((d) => updateItem(d, it.id, { text }))}
                      placeholder={t('editor.experiences.sequence.step_placeholder', { n: i + 1, defaultValue: 'Step {{n}}' })}
                      aria-label={t('editor.experiences.sequence.step_placeholder', { n: i + 1, defaultValue: 'Step {{n}}' })}
                      className={cn(FIELD_CLASS, 'h-9 min-w-0 flex-1')}
                    />
                    <button
                      type="button"
                      className={ICON_BTN}
                      disabled={!canRemove}
                      onClick={() => edit((d) => removeItem(d, it.id))}
                      aria-label={t('editor.experiences.sequence.remove_step', 'Remove step')}
                      title={t('editor.experiences.sequence.remove_step', 'Remove step')}
                    >
                      <Trash size={15} aria-hidden />
                    </button>
                  </div>
                  {timeline && (
                    <div className="ps-[3.75rem] pe-10">
                      <CommitInput
                        value={it.detail ?? ''}
                        onCommit={(detail) => edit((d) => updateItem(d, it.id, { detail }))}
                        placeholder={t('editor.experiences.sequence.detail_placeholder', 'Detail, e.g. 1969')}
                        aria-label={t('editor.experiences.sequence.detail_label', 'Detail')}
                        className={cn(FIELD_CLASS, 'h-8 text-[12px]')}
                      />
                    </div>
                  )}
                  <div className="ps-[3.75rem]">
                    <RowHints issues={issues} id={it.id} text={issueText} />
                  </div>
                </div>
              )
            })}
          </div>
          <AddRowButton disabled={data.items.length >= SEQUENCE_LIMITS.maxItems} onClick={() => edit((d) => addItem(d, newId()))}>
            {t('editor.experiences.sequence.add_step', 'Add step')}
          </AddRowButton>
        </FormSection>
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
          <p className="m-0 text-[12px] leading-snug text-neutral-500">
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
            const edge = dropEdge(drag, i)
            const it = byId.get(id)
            const isSel = selected === id
            return (
              <li
                key={id}
                data-reorder-item=""
                data-seq-id={id}
                className={cn(
                  'relative flex min-w-0 items-center gap-2 rounded-xl px-2 py-1.5 ring-1 transition-[background-color,box-shadow,opacity]',
                  ok === true ? RESULT_CLASS.correct : ok === false ? RESULT_CLASS.wrong : 'bg-white shadow-[0_1px_1px_rgba(0,0,0,0.04)] ring-neutral-200',
                  isSel && 'ring-2 ring-neutral-900',
                  drag?.from === i && 'opacity-50',
                  edge === 'before' && 'before:absolute before:inset-x-2 before:-top-1.5 before:h-0.5 before:rounded before:bg-blue-500',
                  edge === 'after' && 'after:absolute after:inset-x-2 after:-bottom-1.5 after:h-0.5 after:rounded after:bg-blue-500',
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
                    className={GRIP}
                    aria-label={t('activities.experiences.sequence.grip', { item: it?.text ?? '', defaultValue: 'Move “{{item}}” (drag or arrow keys)' })}
                  >
                    <DotsSixVertical size={14} weight="bold" aria-hidden className="pointer-events-none" />
                  </button>
                )}
                <span
                  aria-hidden
                  className={cn(
                    'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
                    ok === undefined ? 'bg-blue-50 text-blue-700' : 'bg-white/80 text-neutral-700',
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
                  className="flex min-w-0 flex-1 touch-manipulation flex-col items-start gap-0.5 rounded-lg px-1 py-1 text-start text-[13px] leading-snug font-medium text-inherit outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50 disabled:cursor-default"
                >
                  <span className="pointer-events-none [overflow-wrap:anywhere]">{it?.text}</span>
                  {timeline && check && it?.detail && (
                    <span className="pointer-events-none rounded-md bg-blue-50 px-1.5 py-px text-[11px] font-semibold tabular-nums text-blue-700">{it.detail}</span>
                  )}
                  {final && ok === false && (
                    <span className="pointer-events-none text-[11px] font-medium text-rose-700">
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
            <button type="button" onClick={onCheck} className={buttonClass('primary', 'sm')}>
              {t('activities.experiences.sequence.check', 'Check order')}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className={cn('m-0 flex items-center gap-2 text-[13px] font-medium', check.perfect ? 'text-emerald-700' : 'text-neutral-700')}>
              <ResultIcon ok={check.perfect} size={16} label="" />
              {check.perfect
                ? t('activities.experiences.sequence.perfect', 'Perfect order!')
                : t('activities.experiences.sequence.result', { done: check.inPlace, total: check.total, defaultValue: '{{done}} of {{total}} in the right place' })}
            </p>
            {!final && (
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={onSecondTry} className={buttonClass('primary', 'sm')}>
                  {t('activities.experiences.sequence.second_try', 'Try once more')}
                </button>
                <span className="text-[12px] text-neutral-500">
                  {t('activities.experiences.sequence.second_try_hint', 'Fix the steps marked wrong, then check again.')}
                </span>
              </div>
            )}
            {final && !check.perfect && (
              <p className="m-0 text-[12px] text-neutral-500">{t('activities.experiences.sequence.answer_shown', 'The correct positions are shown.')}</p>
            )}
          </div>
        )}
      </div>
    </ExperienceFrame>
  )
}
