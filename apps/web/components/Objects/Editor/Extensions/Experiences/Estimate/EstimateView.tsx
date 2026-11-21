'use client'
/*
 Estimate: predict before you learn. Learners lock in a guess with a slider
 (or by typing), then the true value animates in from their guess, with how
 far off they were and stars by the author's tolerance, then the explanation.
 An answer outside the slider range is still shown: the reveal axis widens.
*/
import React from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { ArrowDown, ArrowUp, Gauge, LockSimple, Target } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { CommitInput, FIELD_CLASS, SettingsField } from '../../../Blocks/ui/BlockChrome'
import { InlineHint } from '../Sort/kit'
import { cn } from '@/lib/utils'
import {
  AnswerKeyHint,
  ExperienceFooter,
  ExperienceFrame,
  InlineText,
  SettingsGear,
  useEnsureBlockId,
  useExperienceEditable,
  useLiveAttrs,
  usePrefersReducedMotion,
} from '../shared'
import {
  REVEAL_MS,
  type EstimateData,
  direction,
  formatPct,
  formatValue,
  normalizeEstimate,
  offByPct,
  revealAxis,
  revealValue,
  sliderRange,
  snapGuess,
  starsFor,
  startGuess,
  validateEstimate,
} from './estimateModel'
import { experienceById } from '../registry'

type FrameBase = Omit<React.ComponentProps<typeof ExperienceFrame>, 'children'>

export default function EstimateView(props: NodeViewProps) {
  const { t } = useTranslation()
  const editable = useExperienceEditable(props)
  useEnsureBlockId(props, editable)
  const [attrs, commit] = useLiveAttrs(props)
  const data = React.useMemo(() => normalizeEstimate(attrs), [attrs])
  const [preview, setPreview] = React.useState(false)
  const frame: FrameBase = {
    tone: 'people',
    icon: <Gauge weight="duotone" />,
    title: t('activities.experiences.estimate.heading'),
    editable,
    preview,
    onPreviewChange: setPreview,
    nodeView: props,
    label: t('editor.experiences.estimate.name'),
  }
  return (
    <NodeViewWrapper className="block-exp-estimate">
      {editable && !preview ? (
        <EstimateAuthor data={data} commit={commit} frame={frame} />
      ) : (
        <EstimatePlayer key={JSON.stringify(data)} data={data} frame={frame} />
      )}
    </NodeViewWrapper>
  )
}

// ---- authoring -----------------------------------------------------------
// Edit in place: the learner's slider, with the knob on the true value (an
// "Answer" marker). Drag it, or type the number, to set the answer; the
// question, min, max, step and unit are edited where they show. Tolerance
// lives behind the gear; the explanation sits below as learners get it.

/** The registry's example (what the slash menu inserts), minus its fresh blockId. */
function exampleAttrs(t: TFunction): Record<string, unknown> {
  const { blockId: _drop, ...attrs } = (experienceById('estimate')?.defaultContent(t)?.attrs ?? {}) as Record<string, unknown>
  return attrs
}

/** A number edited in place; text that is not a number snaps back. */
function NumberInline({ value, onCommit, ariaLabel, className }: { value: number; onCommit: (_n: number) => void; ariaLabel: string; className?: string }) {
  const [bump, setBump] = React.useState(0)
  return (
    <InlineText
      key={`${value}:${bump}`}
      fit
      value={String(value)}
      ariaLabel={ariaLabel}
      maxLength={24}
      onCommit={(v) => {
        const n = Number(v.replace(',', '.'))
        if (v.trim() !== '' && Number.isFinite(n)) onCommit(n)
        else setBump((b) => b + 1)
      }}
      className={cn('tabular-nums', className)}
    />
  )
}

function EstimateAuthor({ data, commit, frame }: { data: EstimateData; commit: (_p: any) => void; frame: FrameBase }) {
  const { t, i18n } = useTranslation()
  const k = (s: string, o: Record<string, unknown> = {}) => t(`editor.experiences.estimate.${s}`, o)
  const issues = validateEstimate(data)
  const has = (i: string) => issues.includes(i as any)
  const range = sliderRange(data)
  const fmt = (v: number) => formatValue(v, range.step, i18n?.language)
  const withUnit = (v: number) => (data.unit ? t('activities.experiences.estimate.with_unit', { value: fmt(v), unit: data.unit }) : fmt(v))

  // The knob follows the pointer; the answer is written after a short pause.
  const [drag, setDrag] = React.useState<number | null>(null)
  const pause = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => () => {
    if (pause.current) clearTimeout(pause.current)
  }, [])
  const setAnswer = (n: number) => {
    setDrag(n)
    if (pause.current) clearTimeout(pause.current)
    pause.current = setTimeout(() => {
      commit({ answer: n })
      setDrag(null)
    }, 250)
  }
  const shown = Math.min(range.max, Math.max(range.min, drag ?? data.answer))
  const frac = (shown - range.min) / Math.max(1e-9, range.max - range.min)

  const settings = (
    <SettingsGear>
      <SettingsField label={k('tolerance_label')} hint={k('tolerance_hint', { pct: data.tolerancePct })}>
        <CommitInput
          type="number"
          inputMode="decimal"
          min={0}
          max={100}
          value={String(data.tolerancePct)}
          onCommit={(v) => {
            const n = Number(v)
            if (v.trim() !== '' && Number.isFinite(n)) commit({ tolerancePct: Math.max(0, Math.min(100, n)) })
          }}
          className={cn(FIELD_CLASS, 'tabular-nums')}
        />
      </SettingsField>
    </SettingsGear>
  )

  return (
    <ExperienceFrame
      {...frame}
      wysiwyg
      title={t('activities.experiences.estimate.heading')}
      instructions={t('activities.experiences.estimate.instructions')}
      headerEnd={settings}
      footer={<AnswerKeyHint />}
    >
      <div className="flex flex-col gap-4">
        <InlineText
          multiline
          value={data.question}
          onCommit={(question) => commit({ question })}
          ariaLabel={k('question_label')}
          placeholder={k('question_placeholder')}
          maxLength={300}
          className="text-[15px] leading-snug font-semibold text-neutral-900 [overflow-wrap:anywhere] sm:text-lg"
        />
        {has('emptyQuestion') && (
          <div className="-mt-2 flex flex-wrap items-center gap-x-2 text-[13px] text-neutral-500">
            <InlineHint severity="warning">{k('issue_emptyQuestion')}</InlineHint>
            <button type="button" onClick={() => commit(exampleAttrs(t))} className="font-medium text-neutral-800 underline decoration-dashed underline-offset-2 hover:text-neutral-950">
              {k('fill_example')}
            </button>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="relative min-w-0 flex-1 pt-7">
              {/* The answer, marked on the knob. */}
              <span
                aria-hidden
                className="pointer-events-none absolute top-0 whitespace-nowrap rounded-md bg-gradient-to-b from-indigo-500 to-indigo-600 px-1.5 py-0.5 text-[12px] font-bold tabular-nums text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2px_4px_-1px_rgba(49,46,129,0.4)] rtl:translate-x-1/2 ltr:-translate-x-1/2"
                style={{ insetInlineStart: `calc(${frac * 100}% + ${0.875 - frac * 1.75}rem)` }}
              >
                {k('answer_marker', { value: withUnit(drag ?? data.answer), defaultValue: 'Answer: {{value}}' })}
              </span>
              <div className="relative">
                <div aria-hidden className="lh-exp-well pointer-events-none absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 overflow-hidden rounded-full">
                  <div className="absolute inset-y-0 start-0 rounded-full bg-indigo-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]" style={{ width: `calc(${frac * 100}% + ${0.875 - frac * 1.75}rem)` }} />
                </div>
                <input
                  type="range"
                  min={range.min}
                  max={range.max}
                  step={range.step}
                  value={shown}
                  aria-label={k('answer_label')}
                  aria-valuetext={withUnit(shown)}
                  onChange={(e) => setAnswer(snapGuess(Number(e.target.value), range))}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="lh-exp-range relative block w-full min-w-0"
                />
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 pt-7">
              <CommitInput
                key={data.answer}
                type="text"
                inputMode="decimal"
                value={String(data.answer)}
                aria-label={k('answer_label')}
                onCommit={(v) => {
                  const n = Number(v.replace(',', '.'))
                  if (v.trim() !== '' && Number.isFinite(n)) commit({ answer: n })
                }}
                className={cn(FIELD_CLASS, 'h-10 w-24 text-end text-[14px] tabular-nums')}
              />
              <InlineText
                fit
                value={data.unit}
                onCommit={(unit) => commit({ unit })}
                ariaLabel={k('unit_label')}
                placeholder={k('unit_placeholder')}
                maxLength={16}
                className="text-[13px] text-neutral-500"
              />
            </div>
          </div>
          <div className="-mt-2 flex items-baseline justify-between gap-3 text-[12px] tabular-nums text-neutral-400">
            <NumberInline value={data.min} onCommit={(min) => commit({ min })} ariaLabel={k('min_label')} />
            <span className="inline-flex items-baseline gap-1">
              {k('step_label')}
              <NumberInline value={data.step} onCommit={(step) => commit({ step })} ariaLabel={k('step_label')} />
            </span>
            <NumberInline value={data.max} onCommit={(max) => commit({ max })} ariaLabel={k('max_label')} />
          </div>
          {(['minNotBelowMax', 'stepNotPositive', 'stepTooLarge', 'tooManySteps', 'answerOutside'] as const).filter(has).map((i) => (
            <InlineHint key={i} severity="warning">
              {k(`issue_${i}`)}
            </InlineHint>
          ))}
          {has('answerOffStep') && <InlineHint severity="warning">{k('issue_answerOffStep', { value: formatValue(snapGuess(data.answer, range), range.step) })}</InlineHint>}
        </div>

        {/* Shown to learners after the reveal. */}
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-neutral-400">{k('explanation_label')}</span>
          <div className="rounded-xl bg-indigo-50/60 px-4 py-3">
            <InlineText
              multiline
              value={data.explanation}
              onCommit={(explanation) => commit({ explanation })}
              ariaLabel={k('explanation_label')}
              placeholder={k('explanation_placeholder')}
              maxLength={600}
              className="text-[14px] leading-relaxed text-neutral-700 [overflow-wrap:anywhere]"
            />
          </div>
        </div>
      </div>
    </ExperienceFrame>
  )
}

// ---- learner -------------------------------------------------------------

function EstimatePlayer({ data, frame }: { data: EstimateData; frame: FrameBase }) {
  const { t, i18n } = useTranslation()
  const k = (s: string, o: Record<string, unknown> = {}) => t(`activities.experiences.estimate.${s}`, o)
  const range = React.useMemo(() => sliderRange(data), [data])
  const reduced = usePrefersReducedMotion()
  const [guess, setGuess] = React.useState(() => startGuess(range))
  const [typed, setTyped] = React.useState<string | null>(null)
  const [clampNote, setClampNote] = React.useState(false)
  const [phase, setPhase] = React.useState<'guess' | 'reveal' | 'done'>('guess')
  const [shown, setShown] = React.useState(guess)
  const sliderRef = React.useRef<HTMLInputElement>(null)
  const locale = i18n?.language
  const fmt = (v: number) => formatValue(v, range.step, locale)
  const withUnit = (v: number) => (data.unit ? k('with_unit', { value: fmt(v), unit: data.unit }) : fmt(v))

  const pct = offByPct(guess, data.answer, range)
  const stars = starsFor(pct, data.tolerancePct)
  const axis = revealAxis(range, data.answer)
  const exact = Math.abs(guess - data.answer) < 1e-9

  // The reveal: the true-value marker travels from the guess to the answer.
  React.useEffect(() => {
    if (phase !== 'reveal') return
    let raf = 0
    const t0 = performance.now()
    const tick = () => {
      const el = performance.now() - t0
      setShown(revealValue(guess, data.answer, el))
      if (el >= REVEAL_MS) {
        setPhase('done')
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [phase, reduced, guess, data.answer])

  const live =
    phase !== 'done'
      ? ''
      : exact
        ? k('live_exact', { answer: withUnit(data.answer) })
        : k('live_result', { answer: withUnit(data.answer), pct: formatPct(pct), stars })

  /** Apply what is typed in the number box; returns the resulting guess. */
  const commitTyped = (): number => {
    if (typed === null) return guess
    const n = Number(typed.replace(',', '.'))
    let next = guess
    if (typed.trim() !== '' && Number.isFinite(n)) {
      next = snapGuess(n, range)
      setClampNote(n < range.min || n > range.max)
      setGuess(next)
    }
    setTyped(null)
    return next
  }

  const lockIn = () => {
    const final = commitTyped()
    // Reduced motion: no travelling marker, the result just fades in.
    setShown(reduced ? data.answer : final)
    setPhase(reduced ? 'done' : 'reveal')
  }

  const retry = () => {
    setPhase('guess')
    setGuess(startGuess(range))
    setShown(startGuess(range))
    setClampNote(false)
    requestAnimationFrame(() => sliderRef.current?.focus())
  }

  const footer = phase === 'done' ? <ExperienceFooter stars={stars} score={exact ? k('spot_on') : k('off_by', { pct: formatPct(pct) })} onRetry={retry} /> : undefined
  const dir = direction(guess, data.answer)

  return (
    <ExperienceFrame {...frame} instructions={k('instructions')} footer={footer} live={live} celebrate={phase === 'done' && stars === 3}>
      <div className="flex flex-col gap-4">
        <p className="m-0 text-[15px] leading-snug font-semibold text-neutral-900 [overflow-wrap:anywhere] sm:text-lg">
          {data.question || k('no_question')}
        </p>

        {phase === 'guess' ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="relative min-w-0 flex-1">
                {/* Recessed track with the filled part up to the knob. */}
                <div aria-hidden className="lh-exp-well pointer-events-none absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 overflow-hidden rounded-full">
                  <div
                    className="absolute inset-y-0 start-0 rounded-full bg-indigo-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
                    style={{ width: `calc(${((guess - range.min) / Math.max(1e-9, range.max - range.min)) * 100}% + ${0.875 - (((guess - range.min) / Math.max(1e-9, range.max - range.min)) * 1.75)}rem)` }}
                  />
                </div>
              <input
                ref={sliderRef}
                type="range"
                min={range.min}
                max={range.max}
                step={range.step}
                value={guess}
                aria-label={k('slider_label')}
                aria-valuetext={withUnit(guess)}
                onChange={(e) => {
                  setGuess(snapGuess(Number(e.target.value), range))
                  setTyped(null)
                  setClampNote(false)
                }}
                onKeyDown={(e) => e.stopPropagation()}
                className="lh-exp-range relative block w-full min-w-0"
              />
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <input
                  type="text"
                  inputMode="decimal"
                  value={typed ?? String(guess)}
                  aria-label={k('number_label')}
                  onChange={(e) => setTyped(e.target.value)}
                  onBlur={commitTyped}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitTyped()
                    }
                  }}
                  className={cn(FIELD_CLASS, 'h-10 w-24 text-end text-[14px] tabular-nums')}
                />
                {data.unit && <span className="text-[13px] text-neutral-500">{data.unit}</span>}
              </div>
            </div>
            <div className="-mt-2 flex justify-between text-[12px] tabular-nums text-neutral-400">
              <span>{withUnit(range.min)}</span>
              <span>{withUnit(range.max)}</span>
            </div>
            {clampNote && (
              <p className="m-0 text-[12px] text-amber-700">{k('clamped', { min: withUnit(range.min), max: withUnit(range.max) })}</p>
            )}
            <button type="button" className="lh-exp-key min-h-11 self-start px-5" onClick={lockIn}>
              <LockSimple size={15} weight="bold" aria-hidden />
              {k('lock_in')}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <RevealTrack axis={axis} guess={guess} shown={shown} answer={data.answer} tolerance={data.tolerancePct} done={phase === 'done'} label={withUnit} k={k} />
            {phase === 'done' && (
              <div className="flex flex-col gap-3 animate-in fade-in duration-300">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold',
                      stars === 3 ? 'bg-emerald-50 text-emerald-700' : stars > 0 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700',
                    )}
                  >
                    {exact ? <Target size={14} weight="bold" aria-hidden /> : dir === 'low' ? <ArrowUp size={14} weight="bold" aria-hidden /> : <ArrowDown size={14} weight="bold" aria-hidden />}
                    {exact ? k('spot_on') : k('you_were_off', { pct: formatPct(pct) })}
                  </span>
                  {!exact && <span className="text-[13px] text-neutral-500">{dir === 'low' ? k('too_low') : k('too_high')}</span>}
                </div>
                <p className="m-0 text-[14px] text-neutral-700">{k('answer_is', { answer: withUnit(data.answer) })}</p>
                {data.explanation.trim() && (
                  <p className="m-0 rounded-xl bg-indigo-50/60 px-4 py-3 text-[14px] leading-relaxed text-neutral-700 [overflow-wrap:anywhere]">{data.explanation}</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </ExperienceFrame>
  )
}

function RevealTrack({
  axis,
  guess,
  shown,
  answer,
  tolerance,
  done,
  label,
  k,
}: {
  axis: ReturnType<typeof revealAxis>
  guess: number
  shown: number
  answer: number
  tolerance: number
  done: boolean
  label: (_v: number) => string
  k: (_s: string, _o?: Record<string, unknown>) => string
}) {
  const band = Math.abs(answer) * (tolerance / 100)
  const bandStart = axis.pos(answer - band) * 100
  const bandEnd = axis.pos(answer + band) * 100
  const at = (v: number) => `${axis.pos(v) * 100}%`
  const lo = Math.min(axis.pos(guess), axis.pos(answer)) * 100
  const hi = Math.max(axis.pos(guess), axis.pos(answer)) * 100
  return (
    <div className="flex flex-col gap-2 pt-8 pb-1" aria-hidden>
      <div className="relative">
        <div className="lh-exp-well relative h-2.5 overflow-hidden rounded-full">
          {done && band > 0 && (
            <div className="absolute inset-y-0 rounded-full bg-emerald-300/70 animate-in fade-in duration-300" style={{ insetInlineStart: `${bandStart}%`, width: `${Math.max(0, bandEnd - bandStart)}%` }} />
          )}
        </div>
        {/* The gap between guess and answer, bracketed under the track. */}
        {done && hi - lo > 1 && (
          <span
            className="lh-exp-bracket absolute top-full mt-1.5 h-2 rounded-b-md border-x-2 border-b-2 border-indigo-300"
            style={{ insetInlineStart: `${lo}%`, width: `${hi - lo}%` }}
          />
        )}
        {/* The learner's guess: a raised knob left where it was locked in. */}
        <span
          className="absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border border-black/10 border-b-black/15 bg-white shadow-[inset_0_1px_0_#fff,0_1px_2px_rgba(15,23,42,0.1)] rtl:translate-x-1/2 ltr:-translate-x-1/2"
          style={{ insetInlineStart: at(guess) }}
        >
          <span className="absolute inset-1.5 rounded-full bg-neutral-400" />
        </span>
        {/* The true value, travelling. */}
        <span className="absolute top-1/2 flex -translate-y-1/2 flex-col items-center rtl:translate-x-1/2 ltr:-translate-x-1/2" style={{ insetInlineStart: at(shown) }}>
          <span className="absolute bottom-4 whitespace-nowrap rounded-md bg-gradient-to-b from-indigo-500 to-indigo-600 px-1.5 py-0.5 text-[12px] font-bold tabular-nums text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2px_4px_-1px_rgba(49,46,129,0.4)]">
            {label(done ? answer : shown)}
          </span>
          <span className="h-6 w-1.5 rounded-full bg-indigo-600 shadow-[0_0_0_2px_#fff,0_2px_4px_rgba(49,46,129,0.35)]" />
        </span>
      </div>
      <div className="mt-2 flex justify-between text-[12px] tabular-nums text-neutral-400">
        <span>{label(axis.min)}</span>
        <span className="inline-flex items-center gap-1 text-neutral-500">
          <span className="h-2 w-2 rounded-full bg-neutral-400" />
          {k('your_guess', { value: label(guess) })}
        </span>
        <span>{label(axis.max)}</span>
      </div>
    </div>
  )
}
