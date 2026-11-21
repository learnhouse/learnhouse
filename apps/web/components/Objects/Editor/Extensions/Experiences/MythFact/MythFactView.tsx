'use client'
/*
 Myth or fact. Authors list statements and mark each one fact or myth;
 learners get one card at a time and answer by swiping (pointer events, with
 a distance threshold and a tilt), with the two buttons, or with the arrow
 keys. Each answer reveals the explanation; the end screen shows the score,
 the best streak and the misses.
*/
import React from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { ArrowRight, Check, Fire, Plus, SealQuestion, Trash, WarningCircle, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { CommitInput, FIELD_CLASS, Segmented } from '../../../Blocks/ui/BlockChrome'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import { cn } from '@/lib/utils'
import {
  ExperienceFooter,
  ExperienceFrame,
  buzz,
  newId,
  useEnsureBlockId,
  useExperienceEditable,
  useExperienceMemory,
  useLiveAttrs,
  usePrefersReducedMotion,
} from '../shared'
import {
  DEFAULT_LABELS,
  MAX_STATEMENTS,
  type MythFactData,
  type MythFactIssue,
  type Statement,
  answerCard,
  correctCount,
  isFinished,
  isRevealed,
  keyDecision,
  misses,
  newDeck,
  nextCard,
  normalizeMythFact,
  playable,
  starsFor,
  swipeDecision,
  swipeProgress,
  tiltFor,
  validateMythFact,
} from './mythFactModel'
import { experienceById } from '../registry'

type Labels = { true: string; false: string }

export default function MythFactView(props: NodeViewProps) {
  const { t } = useTranslation()
  const editable = useExperienceEditable(props)
  useEnsureBlockId(props, editable)
  const [attrs, commit] = useLiveAttrs(props)
  const data = React.useMemo(() => normalizeMythFact(attrs), [attrs])
  const [preview, setPreview] = React.useState(false)
  // Empty labels, or the stored English defaults, follow the learner's language.
  const pick = (v: string, fallback: string, key: string) => (!v.trim() || v === fallback ? t(key) : v)
  const labels: Labels = {
    true: pick(data.labels.true, DEFAULT_LABELS.true, 'activities.experiences.myth_fact.fact'),
    false: pick(data.labels.false, DEFAULT_LABELS.false, 'activities.experiences.myth_fact.myth'),
  }
  const frame = {
    tone: 'document' as const,
    icon: <SealQuestion weight="duotone" />,
    title: data.title,
    editable,
    preview,
    onPreviewChange: setPreview,
    nodeView: props,
    label: t('editor.experiences.myth_fact.name'),
  }

  return (
    <NodeViewWrapper className="block-exp-myth-fact">
      {editable && !preview ? (
        <ExperienceFrame
          {...frame}
          onTitleChange={(title) => commit({ title })}
          titlePlaceholder={t('editor.experiences.myth_fact.title_placeholder')}
        >
          <MythFactForm data={data} labels={labels} commit={commit} />
        </ExperienceFrame>
      ) : (
        <MythFactPlayer key={JSON.stringify(data.statements)} data={data} labels={labels} frame={frame} blockId={attrs.blockId} source={props} />
      )}
    </NodeViewWrapper>
  )
}

// ---- authoring -----------------------------------------------------------

/** The registry's example (what the slash menu inserts), minus its fresh blockId. */
function exampleAttrs(t: TFunction): Record<string, unknown> {
  const { blockId: _drop, ...attrs } = (experienceById('mythFact')?.defaultContent(t)?.attrs ?? {}) as Record<string, unknown>
  return attrs
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-0 flex items-start gap-1.5 text-xs leading-snug text-amber-700">
      <WarningCircle size={14} weight="fill" className="mt-px shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

function MythFactForm({ data, labels, commit }: { data: MythFactData; labels: Labels; commit: (_p: any) => void }) {
  const { t } = useTranslation()
  const issues = validateMythFact(data)
  const rowIssue = (id: string) => issues.find((i) => 'id' in i && i.id === id)
  const deckIssues = issues.filter((i) => !('id' in i))
  const editStatements = (fn: (_list: Statement[]) => Statement[]) =>
    commit((live: any) => ({ statements: fn(normalizeMythFact(live).statements) }))
  const patch = (id: string, p: Partial<Statement>) => editStatements((list) => list.map((s) => (s.id === id ? { ...s, ...p } : s)))
  const issueText = (i: MythFactIssue) => t(`editor.experiences.myth_fact.issue_${i.kind}`, { max: MAX_STATEMENTS })

  if (!data.statements.length) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl bg-neutral-50 px-4 py-6 text-center">
        <p className="m-0 text-sm text-neutral-500">{t('editor.experiences.myth_fact.empty')}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" className={buttonClass('primary', 'sm')} onClick={() => commit(exampleAttrs(t))}>
            {t('editor.experiences.myth_fact.fill_example')}
          </button>
          <button
            type="button"
            className={buttonClass('secondary', 'sm')}
            onClick={() => editStatements((list) => [...list, { id: newId(), text: '', isTrue: true, explanation: '' }])}
          >
            <Plus size={14} weight="bold" aria-hidden />
            {t('editor.experiences.myth_fact.add')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-xs font-medium text-neutral-600">{t('editor.experiences.myth_fact.label_true')}</span>
          <CommitInput
            value={data.labels.true}
            placeholder={t('activities.experiences.myth_fact.fact')}
            maxLength={24}
            onCommit={(v) => commit((live: any) => ({ labels: { ...normalizeMythFact(live).labels, true: v } }))}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-xs font-medium text-neutral-600">{t('editor.experiences.myth_fact.label_false')}</span>
          <CommitInput
            value={data.labels.false}
            placeholder={t('activities.experiences.myth_fact.myth')}
            maxLength={24}
            onCommit={(v) => commit((live: any) => ({ labels: { ...normalizeMythFact(live).labels, false: v } }))}
          />
        </label>
      </div>

      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {data.statements.map((s, i) => {
          const issue = rowIssue(s.id)
          return (
            <li key={s.id} className="flex flex-col gap-2 rounded-xl bg-neutral-50 p-3">
              <div className="flex items-start gap-2">
                <span className="mt-1.5 w-5 shrink-0 text-center text-xs font-semibold tabular-nums text-neutral-400">{i + 1}</span>
                <CommitInput
                  value={s.text}
                  onCommit={(text) => patch(s.id, { text })}
                  placeholder={t('editor.experiences.myth_fact.statement_placeholder')}
                  aria-label={t('editor.experiences.myth_fact.statement_label', { n: i + 1 })}
                  maxLength={300}
                  className={cn(FIELD_CLASS, 'flex-1')}
                />
                <button
                  type="button"
                  className={buttonClass('danger-ghost', 'icon', 'shrink-0')}
                  aria-label={t('editor.experiences.myth_fact.remove', { n: i + 1 })}
                  onClick={() => editStatements((list) => list.filter((x) => x.id !== s.id))}
                >
                  <Trash size={14} aria-hidden />
                </button>
              </div>
              <div className="flex flex-col gap-2 ps-7 sm:flex-row sm:items-center">
                <div className="w-full sm:w-48 sm:shrink-0">
                  <Segmented
                    value={s.isTrue ? 'true' : 'false'}
                    ariaLabel={t('editor.experiences.myth_fact.answer_label', { n: i + 1 })}
                    onChange={(v) => patch(s.id, { isTrue: v === 'true' })}
                    options={[
                      { value: 'false', label: <><X size={12} weight="bold" aria-hidden className="text-rose-500" />{labels.false}</> },
                      { value: 'true', label: <><Check size={12} weight="bold" aria-hidden className="text-emerald-600" />{labels.true}</> },
                    ]}
                  />
                </div>
                <CommitInput
                  value={s.explanation}
                  onCommit={(explanation) => patch(s.id, { explanation })}
                  placeholder={t('editor.experiences.myth_fact.explanation_placeholder')}
                  aria-label={t('editor.experiences.myth_fact.explanation_label', { n: i + 1 })}
                  maxLength={400}
                  className={cn(FIELD_CLASS, 'min-w-0 flex-1')}
                />
              </div>
              {issue && <div className="ps-7"><Hint>{issueText(issue)}</Hint></div>}
            </li>
          )
        })}
      </ol>

      {deckIssues.map((i) => (
        <Hint key={i.kind}>{issueText(i)}</Hint>
      ))}

      {data.statements.length < MAX_STATEMENTS && (
        <button
          type="button"
          className={buttonClass('secondary', 'sm', 'self-start')}
          onClick={() => editStatements((list) => [...list, { id: newId(), text: '', isTrue: true, explanation: '' }])}
        >
          <Plus size={14} weight="bold" aria-hidden />
          {t('editor.experiences.myth_fact.add')}
        </button>
      )}
    </div>
  )
}

// ---- learner -------------------------------------------------------------

type FrameBase = Omit<React.ComponentProps<typeof ExperienceFrame>, 'children'>

function MythFactPlayer({ data, labels, frame, blockId, source }: { data: MythFactData; labels: Labels; frame: FrameBase; blockId: string; source: unknown }) {
  const { t } = useTranslation()
  const deck = React.useMemo(() => playable(data), [data])
  const [state, setState] = React.useState(newDeck)
  const [dx, setDx] = React.useState(0)
  const [dragging, setDragging] = React.useState(false)
  const [live, setLive] = React.useState('')
  const reduced = usePrefersReducedMotion()
  const memory = useExperienceMemory(blockId, source)
  const cardRef = React.useRef<HTMLDivElement>(null)
  const nextRef = React.useRef<HTMLButtonElement>(null)
  const drag = React.useRef<{ id: number; x: number; y: number; locked: boolean } | null>(null)
  // Card width and direction, measured when a drag starts (not during render).
  const [dragBox, setDragBox] = React.useState({ width: 300, rtl: false })
  // The answered card flying off the top of the deck while the next one is dealt.
  const [leaving, setLeaving] = React.useState<{ key: number; text: string; dir: 1 | -1; stamp: string; ok: boolean } | null>(null)

  const card = deck[state.index]
  const revealed = isRevealed(state)
  const finished = isFinished(state, deck)
  const answer = revealed ? state.answers[state.index] : null
  const correct = correctCount(state)
  const stars = finished ? starsFor(correct, deck.length) : undefined

  const isRtl = () => {
    try {
      return !!cardRef.current && getComputedStyle(cardRef.current).direction === 'rtl'
    } catch {
      return false
    }
  }

  const decide = (guess: boolean) => {
    if (!card || revealed) return
    const next = answerCard(state, deck, guess)
    setState(next)
    setDx(0)
    const ok = next.answers[next.answers.length - 1]?.correct
    buzz(ok ? 'correct' : 'wrong')
    const label = card.isTrue ? labels.true : labels.false
    setLive(
      `${t(ok ? 'activities.experiences.myth_fact.correct' : 'activities.experiences.myth_fact.wrong')}. ${t('activities.experiences.myth_fact.answer_was', { label })}`,
    )
    requestAnimationFrame(() => nextRef.current?.focus())
  }

  const goNext = () => {
    const next = nextCard(state)
    if (card && answer && !reduced) {
      // Off it goes, toward the side the learner picked (end = fact).
      const guess = answer.correct ? card.isTrue : !card.isTrue
      const dir = ((guess ? 1 : -1) * (isRtl() ? -1 : 1)) as 1 | -1
      setLeaving({ key: state.index, text: card.text, dir, stamp: card.isTrue ? labels.true : labels.false, ok: answer.correct })
    }
    setState(next)
    setLive('')
    if (isFinished(next, deck)) {
      const best = memory.read<number>('best', 0)
      const score = correctCount(next)
      if (score > best) memory.write('best', score)
    } else {
      requestAnimationFrame(() => cardRef.current?.focus())
    }
  }

  const retry = () => {
    setState(newDeck())
    setDx(0)
    setLive('')
    requestAnimationFrame(() => cardRef.current?.focus())
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (finished) return
    if (!revealed) {
      const guess = keyDecision(e.key, isRtl())
      if (guess !== null) {
        e.preventDefault()
        e.stopPropagation()
        decide(guess)
      }
    }
  }

  // Swipe: horizontal drags only; a vertical move first hands the gesture
  // back to the page so it scrolls (touch-action: pan-y on the card).
  const onPointerDown = (e: React.PointerEvent) => {
    if (revealed || (e.pointerType === 'mouse' && e.button !== 0)) return
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, locked: false }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const mx = e.clientX - d.x
    const my = e.clientY - d.y
    if (!d.locked) {
      if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) {
        drag.current = null
        return
      }
      if (Math.abs(mx) < 6) return
      d.locked = true
      setDragBox({ width: cardRef.current?.offsetWidth || 300, rtl: isRtl() })
      setDragging(true)
      try {
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      } catch {
        // capture is best effort
      }
    }
    setDx(mx)
  }
  const endDrag = (e: React.PointerEvent, cancelled = false) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    setDragging(false)
    const width = cardRef.current?.offsetWidth ?? 300
    const guess = cancelled || !d.locked ? null : swipeDecision(e.clientX - d.x, width, isRtl())
    if (guess === null) setDx(0)
    else decide(guess)
  }

  const { width, rtl } = dragBox
  const pull = dragging ? swipeProgress(dx, width) : 0
  const towardEnd = rtl ? dx < 0 : dx > 0
  const tilt = reduced ? 0 : tiltFor(dx, width)

  if (!deck.length) {
    return (
      <ExperienceFrame {...frame} instructions={undefined}>
        <p className="m-0 rounded-xl bg-neutral-50 px-4 py-6 text-center text-[14px] text-neutral-500">{t('activities.experiences.myth_fact.empty')}</p>
      </ExperienceFrame>
    )
  }

  const footer = finished ? (
    <ExperienceFooter
      stars={stars}
      score={t('activities.experiences.myth_fact.score', { correct, total: deck.length })}
      onRetry={retry}
    />
  ) : (
    <ExperienceFooter progress={{ done: state.answers.length, total: deck.length }}>
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
          state.streak >= 2 ? 'bg-orange-50 text-orange-600' : 'text-neutral-500',
        )}
      >
        <Fire size={13} weight={state.streak >= 2 ? 'fill' : 'regular'} aria-hidden />
        {t('activities.experiences.myth_fact.streak', { count: state.streak })}
      </span>
    </ExperienceFooter>
  )

  return (
    <ExperienceFrame
      {...frame}
      instructions={t('activities.experiences.myth_fact.instructions')}
      footer={footer}
      live={live}
      celebrate={finished && stars === 3}
    >
      {finished ? (
        <MythFactResults state={state} deck={deck} labels={labels} />
      ) : (
        <div className="mx-auto flex max-w-md flex-col items-stretch gap-4" onKeyDown={onKeyDown}>
          <div className="relative">
            {/* The rest of the deck, peeking out underneath (up to two cards). */}
            {deck.length - state.index > 2 && (
              <div aria-hidden className="lh-exp-raised absolute inset-x-6 -bottom-3.5 top-3.5 rounded-2xl" />
            )}
            {deck.length - state.index > 1 && (
              <div aria-hidden className="lh-exp-raised absolute inset-x-3 -bottom-[7px] top-[7px] rounded-2xl" />
            )}
            <div
              key={card.id}
              ref={cardRef}
              tabIndex={0}
              role="group"
              aria-roledescription={t('activities.experiences.myth_fact.card_role')}
              aria-label={t('activities.experiences.myth_fact.card_label', { current: state.index + 1, total: deck.length })}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={(e) => endDrag(e)}
              onPointerCancel={(e) => endDrag(e, true)}
              style={{
                transform: dx || tilt ? `translateX(${dx}px) rotate(${tilt}deg)` : undefined,
                transition: dragging ? 'none' : undefined,
                touchAction: 'pan-y',
              }}
              className={cn(
                'lh-exp-raised relative flex min-h-[12rem] select-none flex-col justify-center gap-3 rounded-2xl px-5 pt-12 pb-6 text-center shadow-[inset_0_1px_0_var(--exp-hi),0_1px_2px_var(--exp-drop),0_12px_28px_-14px_rgba(15,23,42,0.3)] outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40',
                !revealed && 'cursor-grab active:cursor-grabbing',
                'lh-exp-deal',
              )}
            >
              {/* Side stamps that ink in as the card is dragged toward them. */}
              {dragging && (
                <span
                  aria-hidden
                  style={{ opacity: pull, ['--exp-rot' as string]: towardEnd ? '8deg' : '-8deg' }}
                  className={cn('lh-exp-stamp absolute top-3', towardEnd ? 'end-3 text-emerald-600' : 'start-3 text-rose-600')}
                >
                  {towardEnd ? <Check size={14} weight="bold" /> : <X size={14} weight="bold" />}
                  {towardEnd ? labels.true : labels.false}
                </span>
              )}
              {/* The verdict, stamped once the card is answered. */}
              {answer && (
                <span
                  aria-hidden
                  style={{ ['--exp-rot' as string]: card.isTrue ? '9deg' : '-9deg' }}
                  className={cn('lh-exp-stamp lh-exp-stamp-in absolute top-2.5 end-3', card.isTrue ? 'text-emerald-600' : 'text-rose-600')}
                >
                  {card.isTrue ? <Check size={14} weight="bold" /> : <X size={14} weight="bold" />}
                  {card.isTrue ? labels.true : labels.false}
                </span>
              )}
              <p className="m-0 text-center text-lg leading-snug font-semibold text-neutral-900 [overflow-wrap:anywhere] sm:text-xl">{card.text}</p>
              {answer && (
                <div className="flex flex-col items-center gap-1.5 animate-in fade-in duration-200">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold',
                      answer.correct ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700',
                    )}
                  >
                    {answer.correct ? <Check size={14} weight="bold" aria-hidden /> : <X size={14} weight="bold" aria-hidden />}
                    {answer.correct ? t('activities.experiences.myth_fact.correct') : t('activities.experiences.myth_fact.wrong')}
                    <span className="sr-only">· {card.isTrue ? labels.true : labels.false}</span>
                  </span>
                  {card.explanation.trim() && (
                    <p className="m-0 text-center text-[14px] leading-relaxed text-neutral-600 [overflow-wrap:anywhere]">{card.explanation}</p>
                  )}
                </div>
              )}
            </div>
            {leaving && (
              <div
                key={`leaving-${leaving.key}`}
                aria-hidden
                onAnimationEnd={() => setLeaving(null)}
                style={{ ['--exp-dir' as string]: leaving.dir }}
                className="lh-exp-raised lh-exp-fly pointer-events-none absolute inset-0 z-10 flex flex-col justify-center rounded-2xl px-5 pt-12 pb-6 text-center shadow-[0_18px_36px_-14px_rgba(15,23,42,0.35)]"
              >
                <span
                  style={{ ['--exp-rot' as string]: leaving.stamp === labels.true ? '9deg' : '-9deg' }}
                  className={cn('lh-exp-stamp absolute top-3 end-3', leaving.stamp === labels.true ? 'text-emerald-600' : 'text-rose-600')}
                >
                  {leaving.stamp}
                </span>
                <p className="m-0 text-lg leading-snug font-semibold text-neutral-900 [overflow-wrap:anywhere] sm:text-xl">{leaving.text}</p>
              </div>
            )}
          </div>

          {revealed ? (
            <button ref={nextRef} type="button" className="lh-exp-key min-h-11 self-center px-5" onClick={goNext}>
              {state.index + 1 >= deck.length ? t('activities.experiences.myth_fact.see_results') : t('activities.experiences.myth_fact.next')}
              <ArrowRight size={15} weight="bold" aria-hidden className="rtl:rotate-180" />
            </button>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => decide(false)}
                className="lh-exp-raised lh-exp-press lh-exp-tint inline-flex h-12 items-center justify-center gap-2 rounded-xl text-[14px] font-semibold text-rose-700 outline-none"
              >
                <X size={16} weight="bold" aria-hidden />
                {labels.false}
              </button>
              <button
                type="button"
                onClick={() => decide(true)}
                className="lh-exp-raised lh-exp-press lh-exp-tint inline-flex h-12 items-center justify-center gap-2 rounded-xl text-[14px] font-semibold text-emerald-700 outline-none"
              >
                <Check size={16} weight="bold" aria-hidden />
                {labels.true}
              </button>
            </div>
          )}
          <p className="m-0 text-center text-[12px] text-neutral-400">
            {t('activities.experiences.myth_fact.card_of', { current: Math.min(state.index + 1, deck.length), total: deck.length })}
          </p>
        </div>
      )}
    </ExperienceFrame>
  )
}

function MythFactResults({ state, deck, labels }: { state: ReturnType<typeof newDeck>; deck: Statement[]; labels: Labels }) {
  const { t } = useTranslation()
  const missed = misses(state, deck)
  return (
    <div className="flex flex-col gap-4 animate-in fade-in duration-300">
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="m-0 text-2xl font-bold tabular-nums text-neutral-900">
          {t('activities.experiences.myth_fact.result', { correct: correctCount(state), total: deck.length })}
        </p>
        <p className="m-0 inline-flex items-center gap-1 text-sm text-neutral-500">
          <Fire size={14} weight="fill" className="text-orange-500" aria-hidden />
          {t('activities.experiences.myth_fact.best_streak', { count: state.bestStreak })}
        </p>
      </div>
      {missed.length ? (
        <div className="flex flex-col gap-2">
          <h4 className="m-0 text-[14px] font-semibold text-neutral-800">{t('activities.experiences.myth_fact.review_title')}</h4>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {missed.map((s) => (
              <li key={s.id} className="flex flex-col gap-1 rounded-xl bg-white p-3 shadow-[0_0_0_1px_var(--exp-edge,rgba(0,0,0,0.08))]">
                <p className="m-0 text-[14px] font-medium text-neutral-900 [overflow-wrap:anywhere]">{s.text}</p>
                <p
                  className={cn(
                    'm-0 inline-flex items-center gap-1 text-xs font-semibold',
                    s.isTrue ? 'text-emerald-700' : 'text-rose-700',
                  )}
                >
                  {s.isTrue ? <Check size={12} weight="bold" aria-hidden /> : <X size={12} weight="bold" aria-hidden />}
                  {t('activities.experiences.myth_fact.answer_was', { label: s.isTrue ? labels.true : labels.false })}
                </p>
                {s.explanation.trim() && <p className="m-0 text-sm leading-relaxed text-neutral-600 [overflow-wrap:anywhere]">{s.explanation}</p>}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="m-0 rounded-xl bg-emerald-50 px-4 py-3 text-center text-sm font-medium text-emerald-700">
          {t('activities.experiences.myth_fact.no_misses')}
        </p>
      )}
    </div>
  )
}
