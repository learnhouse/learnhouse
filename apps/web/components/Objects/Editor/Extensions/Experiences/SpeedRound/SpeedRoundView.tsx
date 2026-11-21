'use client'
/*
 Speed round: timed multiple choice. Authors write short questions with 2–4
 options; learners race a countdown ring per question. Faster answers earn
 more, a combo multiplies the points, wrong answers or timeouts cost a life.
 "Relaxed mode" drops the timer (and the auto-advance) for anyone who needs
 more time. The best score is remembered per block.

 The ring is driven by requestAnimationFrame writing straight to the SVG (no
 React render per frame). The clock itself is a pure value
 (speedRoundModel), paused while the tab is hidden.
*/
import React from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { ArrowRight, Check, Heart, Infinity as InfinityIcon, Lightning, Play, Plus, Timer, Trash, Trophy, WarningCircle, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { CommitInput, FIELD_CLASS } from '../../../Blocks/ui/BlockChrome'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import { cn } from '@/lib/utils'
import {
  ExperienceFooter,
  ExperienceFrame,
  newId,
  useEnsureBlockId,
  useExperienceEditable,
  useExperienceMemory,
  useLiveAttrs,
} from '../shared'
import {
  MAX_LIVES,
  MAX_OPTIONS,
  MAX_QUESTIONS,
  MAX_SECONDS,
  MIN_OPTIONS,
  MIN_SECONDS,
  type Clock,
  type RoundState,
  type SpeedIssue,
  type SpeedQuestion,
  type SpeedRoundData,
  advance,
  answerQuestion,
  bestScore,
  elapsedMs,
  isTimeUp,
  multiplierFor,
  newRound,
  normalizeSpeedRound,
  pauseClock,
  playableQuestions,
  remainingFraction,
  resumeClock,
  secondsLeft,
  starsForRound,
  startClock,
  unansweredIds,
  validateSpeedRound,
} from './speedRoundModel'
import { experienceById } from '../registry'

type FrameBase = Omit<React.ComponentProps<typeof ExperienceFrame>, 'children'>

export default function SpeedRoundView(props: NodeViewProps) {
  const { t } = useTranslation()
  const editable = useExperienceEditable(props)
  useEnsureBlockId(props, editable)
  const [attrs, commit] = useLiveAttrs(props)
  const data = React.useMemo(() => normalizeSpeedRound(attrs), [attrs])
  const [preview, setPreview] = React.useState(false)
  const frame: FrameBase = {
    tone: 'math',
    icon: <Lightning weight="duotone" />,
    title: data.title,
    editable,
    preview,
    onPreviewChange: setPreview,
    nodeView: props,
    label: t('editor.experiences.speed_round.name'),
  }
  return (
    <NodeViewWrapper className="block-exp-speed-round">
      {editable && !preview ? (
        <ExperienceFrame {...frame} onTitleChange={(title) => commit({ title })} titlePlaceholder={t('editor.experiences.speed_round.title_placeholder')}>
          <SpeedRoundForm data={data} commit={commit} />
        </ExperienceFrame>
      ) : (
        <SpeedRoundPlayer key={JSON.stringify([data.questions, data.lives, data.secondsPerQuestion])} data={data} frame={frame} blockId={attrs.blockId} source={props} />
      )}
    </NodeViewWrapper>
  )
}

// ---- authoring -----------------------------------------------------------

/** The registry's example (what the slash menu inserts), minus its fresh blockId. */
function exampleAttrs(t: TFunction): Record<string, unknown> {
  const { blockId: _drop, ...attrs } = (experienceById('speedRound')?.defaultContent(t)?.attrs ?? {}) as Record<string, unknown>
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

function NumberField({ label, hint, value, min, max, onCommit }: { label: string; hint?: string; value: number; min: number; max: number; onCommit: (_n: number) => void }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium text-neutral-600">{label}</span>
      <CommitInput
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={String(value)}
        onCommit={(v) => {
          const n = Math.round(Number(v))
          if (v.trim() !== '' && Number.isFinite(n)) onCommit(Math.max(min, Math.min(max, n)))
        }}
        className={cn(FIELD_CLASS, 'tabular-nums')}
      />
      {hint && <span className="text-[11px] leading-snug text-neutral-400">{hint}</span>}
    </label>
  )
}

function SpeedRoundForm({ data, commit }: { data: SpeedRoundData; commit: (_p: any) => void }) {
  const { t } = useTranslation()
  const issues = validateSpeedRound(data)
  const k = (s: string, o: Record<string, unknown> = {}) => t(`editor.experiences.speed_round.${s}`, o)
  const issueText = (i: SpeedIssue) => k(`issue_${i.kind}`, { min: MIN_OPTIONS })
  const edit = (fn: (_qs: SpeedQuestion[]) => SpeedQuestion[]) => commit((live: any) => ({ questions: fn(normalizeSpeedRound(live).questions) }))
  const patch = (id: string, fn: (_q: SpeedQuestion) => SpeedQuestion) => edit((qs) => qs.map((q) => (q.id === id ? fn(q) : q)))
  const addQuestion = () => edit((qs) => [...qs, { id: newId(), prompt: '', options: ['', ''], answer: 0 }])

  if (!data.questions.length) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl bg-neutral-50 px-4 py-6 text-center">
        <p className="m-0 text-sm text-neutral-500">{k('empty')}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" className={buttonClass('primary', 'sm')} onClick={() => commit(exampleAttrs(t))}>
            {k('fill_example')}
          </button>
          <button type="button" className={buttonClass('secondary', 'sm')} onClick={addQuestion}>
            <Plus size={14} weight="bold" aria-hidden />
            {k('add_question')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label={k('seconds_label')}
          value={data.secondsPerQuestion}
          min={MIN_SECONDS}
          max={MAX_SECONDS}
          onCommit={(secondsPerQuestion) => commit({ secondsPerQuestion })}
        />
        <NumberField label={k('lives_label')} hint={k('lives_hint')} value={data.lives} min={0} max={MAX_LIVES} onCommit={(lives) => commit({ lives })} />
      </div>

      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {data.questions.map((q, qi) => {
          const qIssues = issues.filter((i) => 'id' in i && i.id === q.id)
          return (
            <li key={q.id} className="flex flex-col gap-2 rounded-xl bg-neutral-50 p-3">
              <div className="flex items-start gap-2">
                <span className="mt-1.5 w-5 shrink-0 text-center text-xs font-semibold tabular-nums text-neutral-400">{qi + 1}</span>
                <CommitInput
                  value={q.prompt}
                  onCommit={(prompt) => patch(q.id, (x) => ({ ...x, prompt }))}
                  placeholder={k('prompt_placeholder')}
                  aria-label={k('prompt_label', { n: qi + 1 })}
                  maxLength={200}
                  className={cn(FIELD_CLASS, 'flex-1 font-medium')}
                />
                <button
                  type="button"
                  className={buttonClass('danger-ghost', 'icon', 'shrink-0')}
                  aria-label={k('remove_question', { n: qi + 1 })}
                  onClick={() => edit((qs) => qs.filter((x) => x.id !== q.id))}
                >
                  <Trash size={14} aria-hidden />
                </button>
              </div>
              <div role="radiogroup" aria-label={k('correct_group', { n: qi + 1 })} className="flex flex-col gap-1.5 ps-7">
                {q.options.map((opt, oi) => {
                  const isAnswer = q.answer === oi
                  return (
                    <div key={oi} className="flex items-center gap-2">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={isAnswer}
                        aria-label={k('mark_correct', { n: oi + 1 })}
                        onClick={() => patch(q.id, (x) => ({ ...x, answer: oi }))}
                        className={cn(
                          'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sky-500/40',
                          isAnswer ? 'bg-emerald-500 text-white' : 'bg-white text-transparent shadow-[0_0_0_1px_rgba(0,0,0,0.15)] hover:text-neutral-300',
                        )}
                      >
                        <Check size={12} weight="bold" aria-hidden />
                      </button>
                      <CommitInput
                        value={opt}
                        onCommit={(v) => patch(q.id, (x) => ({ ...x, options: x.options.map((o, j) => (j === oi ? v : o)) }))}
                        placeholder={k('option_placeholder', { n: oi + 1 })}
                        aria-label={k('option_label', { n: oi + 1 })}
                        maxLength={120}
                        className={cn(FIELD_CLASS, 'min-w-0 flex-1')}
                      />
                      {q.options.length > MIN_OPTIONS && (
                        <button
                          type="button"
                          className={buttonClass('ghost', 'icon', 'shrink-0')}
                          aria-label={k('remove_option', { n: oi + 1 })}
                          onClick={() =>
                            patch(q.id, (x) => {
                              const options = x.options.filter((_, j) => j !== oi)
                              const answer = x.answer === oi ? 0 : x.answer > oi ? x.answer - 1 : x.answer
                              return { ...x, options, answer }
                            })
                          }
                        >
                          <X size={13} aria-hidden />
                        </button>
                      )}
                    </div>
                  )
                })}
                {q.options.length < MAX_OPTIONS && (
                  <button
                    type="button"
                    className={buttonClass('ghost', 'sm', 'self-start')}
                    onClick={() => patch(q.id, (x) => ({ ...x, options: [...x.options, ''] }))}
                  >
                    <Plus size={12} weight="bold" aria-hidden />
                    {k('add_option')}
                  </button>
                )}
              </div>
              {qIssues.length > 0 && (
                <div className="flex flex-col gap-1 ps-7">
                  {qIssues.map((i) => (
                    <Hint key={i.kind}>{issueText(i)}</Hint>
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ol>
      {data.questions.length < MAX_QUESTIONS && (
        <button type="button" className={buttonClass('secondary', 'sm', 'self-start')} onClick={addQuestion}>
          <Plus size={14} weight="bold" aria-hidden />
          {k('add_question')}
        </button>
      )}
    </div>
  )
}

// ---- learner -------------------------------------------------------------

const RING_R = 20
const RING_C = 2 * Math.PI * RING_R
const FEEDBACK_MS = { correct: 650, wrong: 1400 }

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function SpeedRoundPlayer({ data, frame, blockId, source }: { data: SpeedRoundData; frame: FrameBase; blockId: string; source: unknown }) {
  const { t } = useTranslation()
  const k = (s: string, o: Record<string, unknown> = {}) => t(`activities.experiences.speed_round.${s}`, o)
  const questions = React.useMemo(() => playableQuestions(data), [data])
  const seconds = data.secondsPerQuestion
  const memory = useExperienceMemory(blockId, source)
  const [phase, setPhase] = React.useState<'start' | 'play' | 'end'>('start')
  const [relaxed, setRelaxed] = React.useState(() => memory.read<boolean>('relaxed', false) === true)
  const [round, setRound] = React.useState<RoundState>(() => newRound(data.lives))
  const [best, setBest] = React.useState(() => bestScore(memory.read('best', 0), 0))
  const [isNewBest, setIsNewBest] = React.useState(false)
  const [live, setLive] = React.useState('')
  // Every setRound goes through answer/goNext/start, which keep this in step.
  const roundRef = React.useRef(round)
  const clock = React.useRef<Clock | null>(null)
  const ringRef = React.useRef<SVGCircleElement>(null)
  const numRef = React.useRef<HTMLSpanElement>(null)
  const promptRef = React.useRef<HTMLHeadingElement>(null)
  const nextRef = React.useRef<HTMLButtonElement>(null)

  const question = questions[round.index]

  const answer = React.useCallback(
    (choice: number | null) => {
      const r = roundRef.current
      const q = questions[r.index]
      if (!q || r.last || r.over) return
      const el = clock.current ? elapsedMs(clock.current, now()) : 0
      const next = answerQuestion(r, questions, choice, el, seconds, relaxed)
      roundRef.current = next
      setRound(next)
      const right = q.options[q.answer]
      if (next.last?.correct) setLive(k('live_correct', { points: next.last.points }))
      else if (choice === null) setLive(k('live_timeout', { answer: right }))
      else setLive(k('live_wrong', { answer: right }))
      if (relaxed) requestAnimationFrame(() => nextRef.current?.focus())
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [questions, seconds, relaxed],
  )

  const finish = React.useCallback(
    (r: RoundState) => {
      const previous = memory.read('best', 0)
      const top = bestScore(previous, r.score)
      setIsNewBest(r.score > 0 && r.score > bestScore(previous, 0))
      setBest(top)
      memory.write('best', top)
      setPhase('end')
      setLive(k('live_end', { score: r.score }))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [memory],
  )

  const goNext = React.useCallback(() => {
    const next = advance(roundRef.current, questions.length)
    roundRef.current = next
    setRound(next)
    if (next.over) finish(next)
  }, [questions.length, finish])

  // A fresh clock for every question.
  React.useEffect(() => {
    if (phase !== 'play' || round.last || round.over) return
    let c = startClock(now())
    if (typeof document !== 'undefined' && document.hidden) c = pauseClock(c, now())
    clock.current = c
    requestAnimationFrame(() => promptRef.current?.focus({ preventScroll: true }))
  }, [phase, round.index, round.last, round.over])

  // Countdown ring: rAF writes the SVG directly; time-up answers null.
  React.useEffect(() => {
    if (phase !== 'play' || relaxed || round.last || round.over) return
    let raf = 0
    const tick = () => {
      const c = clock.current
      if (!c) return
      const el = elapsedMs(c, now())
      const frac = remainingFraction(el, seconds)
      if (ringRef.current) {
        ringRef.current.style.strokeDashoffset = String(RING_C * (1 - frac))
        ringRef.current.classList.toggle('text-rose-500', frac < 0.3)
        ringRef.current.classList.toggle('text-orange-500', frac >= 0.3)
      }
      if (numRef.current) numRef.current.textContent = String(secondsLeft(el, seconds))
      if (isTimeUp(el, seconds)) {
        answer(null)
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [phase, relaxed, round.index, round.last, round.over, seconds, answer])

  // Hidden tab: stop the clock, so nobody loses a question to a phone call.
  React.useEffect(() => {
    if (phase !== 'play') return
    const onVisibility = () => {
      const c = clock.current
      if (!c) return
      clock.current = document.hidden ? pauseClock(c, now()) : resumeClock(c, now())
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [phase])

  // Timed mode moves on by itself after a short feedback beat.
  React.useEffect(() => {
    if (phase !== 'play' || relaxed || !round.last) return
    const id = window.setTimeout(goNext, round.last.correct ? FEEDBACK_MS.correct : FEEDBACK_MS.wrong)
    return () => window.clearTimeout(id)
  }, [phase, relaxed, round.last, goNext])

  const start = () => {
    const r = newRound(data.lives)
    roundRef.current = r
    setRound(r)
    setIsNewBest(false)
    setLive('')
    setPhase('play')
  }

  const toggleRelaxed = () => {
    const v = !relaxed
    setRelaxed(v)
    memory.write('relaxed', v)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (phase !== 'play' || !question || round.last) return
    const n = Number(e.key)
    if (Number.isInteger(n) && n >= 1 && n <= question.options.length) {
      e.preventDefault()
      e.stopPropagation()
      answer(n - 1)
    }
  }

  if (!questions.length) {
    return (
      <ExperienceFrame {...frame}>
        <p className="m-0 rounded-xl bg-neutral-50 px-4 py-6 text-center text-sm text-neutral-500">{k('empty')}</p>
      </ExperienceFrame>
    )
  }

  const total = questions.length
  const stars = phase === 'end' ? starsForRound(round.correct, total) : undefined
  const footer =
    phase === 'end' ? (
      <ExperienceFooter stars={stars} score={k('points', { count: round.score })} onRetry={() => setPhase('start')} />
    ) : phase === 'play' ? (
      <ExperienceFooter progress={{ done: round.index + (round.last ? 1 : 0), total }} />
    ) : undefined

  return (
    <ExperienceFrame {...frame} instructions={k('instructions')} footer={footer} live={live} celebrate={phase === 'end' && (stars === 3 || isNewBest)}>
      {phase === 'start' && (
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <p className="m-0 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-neutral-600">
            <span>{k('meta_questions', { count: total })}</span>
            {!relaxed && (
              <span className="inline-flex items-center gap-1">
                <Timer size={14} aria-hidden />
                {k('meta_seconds', { count: seconds })}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Heart size={14} weight="fill" className="text-rose-500" aria-hidden />
              {data.lives > 0 ? k('meta_lives', { count: data.lives }) : k('meta_unlimited')}
            </span>
          </p>
          {best > 0 && (
            <p className="m-0 inline-flex items-center gap-1 text-xs font-medium text-amber-700">
              <Trophy size={13} weight="fill" aria-hidden />
              {k('best', { count: best })}
            </p>
          )}
          <button
            type="button"
            role="switch"
            aria-checked={relaxed}
            onClick={toggleRelaxed}
            className="inline-flex items-center gap-2.5 rounded-xl px-2 py-1 text-start outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
          >
            <span className={cn('relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors motion-reduce:transition-none', relaxed ? 'bg-emerald-500' : 'bg-neutral-300')}>
              <span
                className={cn(
                  'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[inset-inline-start] motion-reduce:transition-none',
                  relaxed ? 'start-[1.125rem]' : 'start-0.5',
                )}
              />
            </span>
            <span className="flex flex-col">
              <span className="text-sm font-medium text-neutral-800">{k('relaxed')}</span>
              <span className="text-xs text-neutral-500">{k('relaxed_hint')}</span>
            </span>
          </button>
          <button type="button" className={buttonClass('primary', 'lg')} onClick={start}>
            <Play size={15} weight="fill" aria-hidden />
            {k('start')}
          </button>
        </div>
      )}

      {phase === 'play' && question && (
        <div className="flex flex-col gap-4" onKeyDown={onKeyDown}>
          <div className="flex items-center justify-between gap-3">
            <Lives total={data.lives} left={round.livesLeft} />
            <div className="flex items-center gap-2">
              {multiplierFor(round.combo) > 1 && (
                <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs font-bold tabular-nums text-orange-600 animate-in zoom-in-75 duration-200 motion-reduce:zoom-in-100">
                  {k('combo', { n: multiplierFor(round.combo) })}
                </span>
              )}
              <span className="text-sm font-semibold tabular-nums text-neutral-800">{k('points', { count: round.score })}</span>
            </div>
          </div>
          <div className="flex items-start gap-3">
            {relaxed ? (
              <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">{k('relaxed')}</span>
            ) : (
              <span className="relative inline-flex h-12 w-12 shrink-0 items-center justify-center" aria-hidden>
                <svg viewBox="0 0 48 48" className="absolute inset-0 -rotate-90">
                  <circle cx="24" cy="24" r={RING_R} fill="none" strokeWidth="4" className="stroke-neutral-100" />
                  <circle
                    ref={ringRef}
                    cx="24"
                    cy="24"
                    r={RING_R}
                    fill="none"
                    strokeWidth="4"
                    strokeLinecap="round"
                    stroke="currentColor"
                    strokeDasharray={RING_C}
                    strokeDashoffset={round.last ? RING_C : 0}
                    className="text-orange-500"
                  />
                </svg>
                <span ref={numRef} className="text-sm font-bold tabular-nums text-neutral-800">
                  {round.last ? 0 : seconds}
                </span>
              </span>
            )}
            <h4 ref={promptRef} tabIndex={-1} className="m-0 min-w-0 flex-1 self-center text-base leading-snug font-semibold text-neutral-900 outline-none [overflow-wrap:anywhere] sm:text-lg">
              {question.prompt}
            </h4>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {question.options.map((opt, i) => {
              const last = round.last
              const isAnswer = i === question.answer
              const picked = last?.choice === i
              const state = !last ? 'idle' : isAnswer ? 'right' : picked ? 'wrong' : 'dim'
              return (
                <button
                  key={i}
                  type="button"
                  disabled={!!last}
                  onClick={() => answer(i)}
                  className={cn(
                    'flex min-h-12 items-center gap-2.5 rounded-xl px-3 py-2.5 text-start text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sky-500/40 motion-reduce:transition-none',
                    state === 'idle' && 'bg-white text-neutral-800 shadow-[0_0_0_1px_rgba(0,0,0,0.1)] hover:bg-orange-50/60 active:scale-[0.99]',
                    state === 'right' && 'bg-emerald-50 text-emerald-800 ring-2 ring-emerald-400',
                    state === 'wrong' && 'bg-rose-50 text-rose-800 ring-2 ring-rose-400 lh-exp-shake',
                    state === 'dim' && 'bg-neutral-50 text-neutral-400',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold',
                      state === 'right' ? 'bg-emerald-500 text-white' : state === 'wrong' ? 'bg-rose-500 text-white' : 'bg-neutral-100 text-neutral-500',
                    )}
                  >
                    {state === 'right' ? <Check size={12} weight="bold" /> : state === 'wrong' ? <X size={12} weight="bold" /> : i + 1}
                  </span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">{opt}</span>
                </button>
              )
            })}
          </div>
          <div className="flex min-h-9 items-center justify-center">
            {round.last &&
              (round.last.correct ? (
                <span className="text-sm font-bold tabular-nums text-emerald-600 animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:slide-in-from-bottom-0">
                  {k('plus_points', { count: round.last.points })}
                </span>
              ) : (
                <span className="text-sm font-medium text-rose-600 animate-in fade-in duration-200">
                  {round.last.choice === null ? k('time_up') : k('wrong')}
                </span>
              ))}
            {round.last && relaxed && (
              <button ref={nextRef} type="button" className={buttonClass('primary', 'md', 'ms-3')} onClick={goNext}>
                {round.index + 1 >= total || round.livesLeft === 0 ? k('see_results') : k('next')}
                <ArrowRight size={14} weight="bold" aria-hidden className="rtl:rotate-180" />
              </button>
            )}
          </div>
        </div>
      )}

      {phase === 'end' && <SpeedRoundResults round={round} questions={questions} best={best} isNewBest={isNewBest} />}
    </ExperienceFrame>
  )
}

function Lives({ total, left }: { total: number; left: number | null }) {
  const { t } = useTranslation()
  if (left === null) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-neutral-500">
        <InfinityIcon size={16} weight="bold" aria-hidden />
        {t('activities.experiences.speed_round.meta_unlimited')}
      </span>
    )
  }
  return (
    <span role="img" aria-label={t('activities.experiences.speed_round.lives_left', { left, total })} className="inline-flex items-center gap-0.5">
      {Array.from({ length: total }, (_, i) => (
        <Heart key={i} size={18} weight={i < left ? 'fill' : 'regular'} aria-hidden className={i < left ? 'text-rose-500' : 'text-neutral-300'} />
      ))}
    </span>
  )
}

function SpeedRoundResults({ round, questions, best, isNewBest }: { round: RoundState; questions: SpeedQuestion[]; best: number; isNewBest: boolean }) {
  const { t } = useTranslation()
  const k = (s: string, o: Record<string, unknown> = {}) => t(`activities.experiences.speed_round.${s}`, o)
  const byId = new Map(questions.map((q) => [q.id, q]))
  const notReached = unansweredIds(round, questions)
  const review = [
    ...round.misses.map((m) => ({ q: byId.get(m.questionId), choice: m.choice, reached: true })),
    ...notReached.map((id) => ({ q: byId.get(id), choice: null, reached: false })),
  ].filter((r): r is { q: SpeedQuestion; choice: number | null; reached: boolean } => !!r.q)

  return (
    <div className="flex flex-col gap-4 animate-in fade-in duration-300">
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="m-0 text-3xl font-bold tabular-nums text-neutral-900">{k('points', { count: round.score })}</p>
        <p className="m-0 text-sm text-neutral-500">
          {k('result', { correct: round.correct, total: questions.length })} · {k('best_combo', { count: round.bestCombo })}
        </p>
        <p className={cn('m-0 mt-1 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', isNewBest ? 'bg-amber-50 text-amber-700' : 'text-neutral-500')}>
          <Trophy size={13} weight="fill" aria-hidden className="text-amber-500" />
          {isNewBest ? k('new_best') : k('best', { count: best })}
        </p>
      </div>
      {review.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h4 className="m-0 text-sm font-semibold text-neutral-800">{k('review_title')}</h4>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {review.map(({ q, choice, reached }) => (
              <li key={q.id} className="flex flex-col gap-1 rounded-xl bg-neutral-50 p-3">
                <p className="m-0 text-sm font-medium text-neutral-900 [overflow-wrap:anywhere]">{q.prompt}</p>
                <p className="m-0 inline-flex items-start gap-1 text-sm text-emerald-700">
                  <Check size={14} weight="bold" aria-hidden className="mt-0.5 shrink-0" />
                  <span className="[overflow-wrap:anywhere]">{k('correct_answer', { answer: q.options[q.answer] })}</span>
                </p>
                <p className="m-0 inline-flex items-start gap-1 text-xs text-rose-600">
                  <X size={12} weight="bold" aria-hidden className="mt-0.5 shrink-0" />
                  <span className="[overflow-wrap:anywhere]">
                    {!reached ? k('not_reached') : choice === null ? k('time_up') : k('your_answer', { answer: q.options[choice] ?? '' })}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="m-0 rounded-xl bg-emerald-50 px-4 py-3 text-center text-sm font-medium text-emerald-700">{k('no_misses')}</p>
      )}
    </div>
  )
}
