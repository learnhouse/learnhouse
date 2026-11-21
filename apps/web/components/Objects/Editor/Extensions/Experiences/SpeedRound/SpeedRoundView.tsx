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
import { ArrowRight, Check, Heart, Infinity as InfinityIcon, Lightning, Play, Timer, Trophy, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { CommitInput, FIELD_CLASS, SettingsField } from '../../../Blocks/ui/BlockChrome'
import { InlineHint } from '../Sort/kit'
import { cn } from '@/lib/utils'
import {
  AddGhost,
  AnswerKeyHint,
  CardNav,
  CorrectMark,
  EDIT_OBJECT,
  ExperienceFooter,
  ExperienceFrame,
  InlineText,
  RemoveX,
  SettingsGear,
  buzz,
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
        <SpeedRoundAuthor data={data} commit={commit} frame={frame} />
      ) : (
        <SpeedRoundPlayer key={JSON.stringify([data.questions, data.lives, data.secondsPerQuestion])} data={data} frame={frame} blockId={attrs.blockId} source={props} />
      )}
    </NodeViewWrapper>
  )
}

// ---- authoring -----------------------------------------------------------
// Edit in place: one question card at a time, as learners see it mid-round.
// The prompt and options are edited where they sit; the check badge marks the
// right option. Prev / next and "+ Add question" move through the round;
// timer and lives live behind the gear.

/** The registry's example (what the slash menu inserts), minus its fresh blockId. */
function exampleAttrs(t: TFunction): Record<string, unknown> {
  const { blockId: _drop, ...attrs } = (experienceById('speedRound')?.defaultContent(t)?.attrs ?? {}) as Record<string, unknown>
  return attrs
}

function NumberField({ label, hint, value, min, max, onCommit }: { label: string; hint?: string; value: number; min: number; max: number; onCommit: (_n: number) => void }) {
  return (
    <SettingsField label={label} hint={hint}>
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
    </SettingsField>
  )
}

function SpeedRoundAuthor({ data, commit, frame }: { data: SpeedRoundData; commit: (_p: any) => void; frame: FrameBase }) {
  const { t } = useTranslation()
  const k = (s: string, o: Record<string, unknown> = {}) => t(`editor.experiences.speed_round.${s}`, o)
  const issues = validateSpeedRound(data)
  const issueText = (i: SpeedIssue) => k(`issue_${i.kind}`, { min: MIN_OPTIONS })
  const edit = (fn: (_qs: SpeedQuestion[]) => SpeedQuestion[]) => commit((live: any) => ({ questions: fn(normalizeSpeedRound(live).questions) }))
  const patch = (id: string, fn: (_q: SpeedQuestion) => SpeedQuestion) => edit((qs) => qs.map((q) => (q.id === id ? fn(q) : q)))
  const [index, setIndex] = React.useState(0)
  const [live, setLive] = React.useState('')
  const count = data.questions.length
  const i = Math.min(index, Math.max(0, count - 1))
  const q = data.questions[i]
  const rootRef = React.useRef<HTMLDivElement>(null)

  // Focus a new or neighbouring field once it has rendered.
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
  const focusLater = (sel: string) => {
    pendingFocus.current = sel
    requestAnimationFrame(tryFocus)
  }

  const go = (n: number) => {
    const next = Math.max(0, Math.min(count - 1, n))
    setIndex(next)
    setLive(t('editor.experiences.speed_round.question_of', { n: next + 1, total: count, defaultValue: 'Question {{n}} of {{total}}' }))
  }
  const addQuestion = () => {
    edit((qs) => [...qs, { id: newId(), prompt: '', options: ['', ''], answer: 0 }])
    setIndex(count)
    focusLater('[data-prompt] textarea')
  }
  const removeQuestion = () => {
    if (!q) return
    edit((qs) => qs.filter((x) => x.id !== q.id))
    setIndex(data.questions[i + 1] ? i : Math.max(0, i - 1))
    focusLater('[data-prompt] textarea')
  }
  const addOption = () => {
    if (!q) return
    patch(q.id, (x) => ({ ...x, options: [...x.options, ''] }))
    focusLater(`[data-option="${q.options.length}"] textarea`)
  }
  const removeOption = (oi: number) => {
    if (!q) return
    patch(q.id, (x) => {
      const options = x.options.filter((_, j) => j !== oi)
      const answer = x.answer === oi ? 0 : x.answer > oi ? x.answer - 1 : x.answer
      return { ...x, options, answer }
    })
    focusLater(`[data-option="${Math.max(0, oi - 1)}"] textarea`)
  }

  const settings = (
    <SettingsGear>
      <NumberField label={k('seconds_label')} value={data.secondsPerQuestion} min={MIN_SECONDS} max={MAX_SECONDS} onCommit={(secondsPerQuestion) => commit({ secondsPerQuestion })} />
      <NumberField label={k('lives_label')} hint={k('lives_hint')} value={data.lives} min={0} max={MAX_LIVES} onCommit={(lives) => commit({ lives })} />
    </SettingsGear>
  )

  const shell = (children: React.ReactNode) => (
    <ExperienceFrame
      {...frame}
      wysiwyg
      onTitleChange={(title) => commit({ title })}
      titlePlaceholder={k('title_placeholder')}
      instructions={t('activities.experiences.speed_round.instructions')}
      headerEnd={settings}
      footer={<AnswerKeyHint />}
      live={live}
    >
      <div ref={rootRef}>{children}</div>
    </ExperienceFrame>
  )

  if (!q) {
    return shell(
      <div className="mx-auto flex max-w-md flex-col items-stretch gap-3">
        <AddGhost onClick={addQuestion} className="min-h-[10rem] w-full rounded-2xl text-[14px]">
          {k('add_question')}
        </AddGhost>
        <p className="m-0 text-center text-[13px] text-neutral-500">
          {k('empty')}{' '}
          <button type="button" onClick={() => commit(exampleAttrs(t))} className="font-medium text-neutral-800 underline decoration-dashed underline-offset-2 hover:text-neutral-950">
            {k('fill_example')}
          </button>
        </p>
      </div>,
    )
  }

  const qIssues = issues.filter((x) => 'id' in x && x.id === q.id)
  const flagged = (n: number) => issues.some((x) => 'id' in x && x.id === data.questions[n]?.id)

  return shell(
    <div className="flex flex-col gap-4">
      <div className={cn('relative flex flex-col gap-4', EDIT_OBJECT)}>
        <div className="flex items-center justify-between gap-3">
          <Lives total={data.lives} left={data.lives > 0 ? data.lives : null} />
          <span className="text-[13px] font-medium tabular-nums text-neutral-500">
            {t('editor.experiences.speed_round.question_of', { n: i + 1, total: count, defaultValue: 'Question {{n}} of {{total}}' })}
          </span>
        </div>
        <div className="flex items-start gap-3">
          <span className="lh-exp-well relative inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full" aria-hidden>
            <svg viewBox="0 0 48 48" className="absolute inset-1 -rotate-90">
              <circle cx="24" cy="24" r={RING_R} fill="none" strokeWidth="4" stroke="currentColor" className="text-orange-500" />
            </svg>
            <span className="lh-exp-raised relative inline-flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-bold tabular-nums text-neutral-800">
              {data.secondsPerQuestion}
            </span>
          </span>
          <div data-prompt="" className="min-w-0 flex-1 self-center">
            <InlineText
              value={q.prompt}
              onCommit={(prompt) => patch(q.id, (x) => ({ ...x, prompt }))}
              placeholder={k('prompt_placeholder')}
              ariaLabel={k('prompt_label', { n: i + 1 })}
              maxLength={200}
              className="text-[15px] leading-snug font-semibold text-neutral-900 [overflow-wrap:anywhere] sm:text-lg"
            />
          </div>
        </div>
        <div role="group" aria-label={k('correct_group', { n: i + 1 })} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {q.options.map((opt, oi) => {
            const isAnswer = q.answer === oi
            return (
              <div
                key={oi}
                data-option={oi}
                className={cn('lh-exp-raised relative flex min-h-12 items-center gap-2.5 rounded-xl px-3 py-2.5 text-start text-[14px] font-medium text-neutral-800', EDIT_OBJECT)}
              >
                <span
                  aria-hidden
                  className={cn('inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[12px] font-bold', isAnswer ? 'bg-emerald-500 text-white' : 'lh-exp-well text-neutral-500')}
                >
                  {isAnswer ? <Check size={12} weight="bold" /> : oi + 1}
                </span>
                <InlineText
                  value={opt}
                  onCommit={(v) => patch(q.id, (x) => ({ ...x, options: x.options.map((o, j) => (j === oi ? v : o)) }))}
                  placeholder={k('option_placeholder', { n: oi + 1 })}
                  ariaLabel={k('option_label', { n: oi + 1 })}
                  maxLength={120}
                  className="min-w-0 flex-1 [overflow-wrap:anywhere]"
                />
                <CorrectMark checked={isAnswer} onChange={() => patch(q.id, (x) => ({ ...x, answer: oi }))} label={k('mark_correct', { n: oi + 1 })} />
                <RemoveX floating disabled={q.options.length <= MIN_OPTIONS} onClick={() => removeOption(oi)} label={k('remove_option', { n: oi + 1 })} />
              </div>
            )
          })}
          {q.options.length < MAX_OPTIONS && (
            <AddGhost onClick={addOption} className="min-h-12 rounded-xl px-3 text-[14px]">
              {k('add_option')}
            </AddGhost>
          )}
        </div>
        <RemoveX floating onClick={removeQuestion} label={k('remove_question', { n: i + 1 })} className="-top-3 -end-3" />
      </div>
      {qIssues.map((x) => (
        <InlineHint key={x.kind} severity="warning">
          {issueText(x)}
        </InlineHint>
      ))}
      <CardNav
        count={count}
        index={i}
        onGo={go}
        onAdd={addQuestion}
        canAdd={count < MAX_QUESTIONS}
        addLabel={k('add_question')}
        itemLabel={(n) => t('editor.experiences.speed_round.question_of', { n, total: count, defaultValue: 'Question {{n}} of {{total}}' })}
        flagged={flagged}
        prevLabel={t('editor.experiences.speed_round.prev_question', 'Previous question')}
        nextLabel={t('editor.experiences.speed_round.next_question', 'Next question')}
      />
    </div>,
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
      buzz(next.last?.correct ? 'correct' : 'wrong')
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
        <p className="m-0 rounded-xl bg-neutral-50 px-4 py-6 text-center text-[14px] text-neutral-500">{k('empty')}</p>
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
          <p className="m-0 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[14px] text-neutral-600">
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
            <p className="m-0 inline-flex items-center gap-1 text-[12px] font-medium text-amber-700">
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
            <span
              className={cn(
                'relative inline-flex h-6 w-10 shrink-0 rounded-full transition-colors motion-reduce:transition-none',
                relaxed ? 'bg-emerald-500 shadow-[inset_0_1px_2px_rgba(0,0,0,0.2)]' : 'lh-exp-well',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-[inset_0_1px_0_#fff,0_1px_2px_rgba(15,23,42,0.25),0_0_0_1px_rgba(15,23,42,0.08)] transition-[inset-inline-start] motion-reduce:transition-none',
                  relaxed ? 'start-[1.125rem]' : 'start-0.5',
                )}
              />
            </span>
            <span className="flex flex-col">
              <span className="text-[14px] font-medium text-neutral-800">{k('relaxed')}</span>
              <span className="text-[12px] text-neutral-500">{k('relaxed_hint')}</span>
            </span>
          </button>
          <button type="button" className="lh-exp-key min-h-11 px-6" onClick={start}>
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
                <span key={multiplierFor(round.combo)} className="lh-exp-snap inline-block rounded-full bg-orange-50 px-2 py-0.5 text-[12px] font-bold tabular-nums text-orange-600">
                  {k('combo', { n: multiplierFor(round.combo) })}
                </span>
              )}
              <span className="text-[14px] font-semibold tabular-nums text-neutral-800">{k('points', { count: round.score })}</span>
            </div>
          </div>
          <div className="flex items-start gap-3">
            {relaxed ? (
              <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-50 px-2 py-1 text-[12px] font-medium text-emerald-700">{k('relaxed')}</span>
            ) : (
              <span className="lh-exp-well relative inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full" aria-hidden>
                <svg viewBox="0 0 48 48" className="absolute inset-1 -rotate-90">
                  <circle cx="24" cy="24" r={RING_R} fill="none" strokeWidth="4" className="stroke-neutral-200" />
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
                <span ref={numRef} className="lh-exp-raised relative inline-flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-bold tabular-nums text-neutral-800">
                  {round.last ? 0 : seconds}
                </span>
              </span>
            )}
            <h4 ref={promptRef} tabIndex={-1} className="m-0 min-w-0 flex-1 self-center text-[15px] leading-snug font-semibold text-neutral-900 outline-none [overflow-wrap:anywhere] sm:text-lg">
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
                  data-result={state === 'right' ? 'correct' : state === 'wrong' ? 'wrong' : undefined}
                  className={cn(
                    'lh-exp-raised lh-exp-press flex min-h-12 items-center gap-2.5 rounded-xl px-3 py-2.5 text-start text-[14px] font-medium outline-none disabled:cursor-default',
                    state === 'idle' && 'text-neutral-800',
                    state === 'wrong' && 'lh-exp-shake',
                    state === 'dim' && 'text-neutral-400 opacity-60',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[12px] font-bold',
                      state === 'right' ? 'bg-emerald-500 text-white' : state === 'wrong' ? 'bg-rose-500 text-white' : 'lh-exp-well text-neutral-500',
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
                <span key={round.index} className="lh-exp-rise inline-flex items-center gap-1.5 text-[14px] font-bold tabular-nums text-emerald-600">
                  {k('plus_points', { count: round.last.points })}
                  {multiplierFor(round.combo) > 1 && (
                    <span className="rounded-full bg-orange-50 px-1.5 py-px text-[12px] text-orange-600">{k('combo', { n: multiplierFor(round.combo) })}</span>
                  )}
                </span>
              ) : (
                <span className="text-[14px] font-medium text-rose-600 animate-in fade-in duration-200">
                  {round.last.choice === null ? k('time_up') : k('wrong')}
                </span>
              ))}
            {round.last && relaxed && (
              <button ref={nextRef} type="button" className="lh-exp-key ms-3" onClick={goNext}>
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
        <p className="m-0 text-[13px] text-neutral-500">
          {k('result', { correct: round.correct, total: questions.length })} · {k('best_combo', { count: round.bestCombo })}
        </p>
        <p className={cn('m-0 mt-1 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', isNewBest ? 'bg-amber-50 text-amber-700' : 'text-neutral-500')}>
          <Trophy size={13} weight="fill" aria-hidden className="text-amber-500" />
          {isNewBest ? k('new_best') : k('best', { count: best })}
        </p>
      </div>
      {review.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h4 className="m-0 text-[14px] font-semibold text-neutral-800">{k('review_title')}</h4>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {review.map(({ q, choice, reached }) => (
              <li key={q.id} className="flex flex-col gap-1 rounded-xl bg-white p-3 shadow-[0_0_0_1px_var(--exp-edge,rgba(0,0,0,0.08))]">
                <p className="m-0 text-[14px] font-medium text-neutral-900 [overflow-wrap:anywhere]">{q.prompt}</p>
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
