'use client'
/*
 Estimate: predict before you learn. Learners lock in a guess with a slider
 (or by typing), then the true value animates in from their guess, with how
 far off they were and stars by the author's tolerance, then the explanation.
 An answer outside the slider range is still shown: the reveal axis widens.
*/
import React from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { ArrowDown, ArrowUp, Gauge, LockSimple, Target, WarningCircle } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { CommitInput, FIELD_CLASS } from '../../../Blocks/ui/BlockChrome'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import { cn } from '@/lib/utils'
import { ExperienceFooter, ExperienceFrame, useEnsureBlockId, useExperienceEditable, useLiveAttrs, usePrefersReducedMotion } from '../shared'
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
        <ExperienceFrame {...frame} title={t('editor.experiences.estimate.name')}>
          <EstimateForm data={data} commit={commit} />
        </ExperienceFrame>
      ) : (
        <EstimatePlayer key={JSON.stringify(data)} data={data} frame={frame} />
      )}
    </NodeViewWrapper>
  )
}

// ---- authoring -----------------------------------------------------------

/** The registry's example (what the slash menu inserts), minus its fresh blockId. */
function exampleAttrs(t: TFunction): Record<string, unknown> {
  const { blockId: _drop, ...attrs } = (experienceById('estimate')?.defaultContent(t)?.attrs ?? {}) as Record<string, unknown>
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

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-xs font-medium text-neutral-600">{label}</span>
      {children}
    </label>
  )
}

function NumberInput({ value, onCommit, label }: { value: number; onCommit: (_n: number) => void; label?: string }) {
  return (
    <CommitInput
      type="number"
      inputMode="decimal"
      step="any"
      value={String(value)}
      aria-label={label}
      onCommit={(v) => {
        const n = Number(v)
        if (v.trim() !== '' && Number.isFinite(n)) onCommit(n)
      }}
      className={cn(FIELD_CLASS, 'tabular-nums')}
    />
  )
}

function EstimateForm({ data, commit }: { data: EstimateData; commit: (_p: any) => void }) {
  const { t } = useTranslation()
  const k = (s: string, o: Record<string, unknown> = {}) => t(`editor.experiences.estimate.${s}`, o)
  const issues = validateEstimate(data)
  const has = (i: string) => issues.includes(i as any)
  const range = sliderRange(data)
  return (
    <div className="flex flex-col gap-3">
      <Field label={k('question_label')}>
        <CommitInput multiline value={data.question} onCommit={(question) => commit({ question })} placeholder={k('question_placeholder')} aria-label={k('question_label')} />
      </Field>
      {has('emptyQuestion') && (
        <div className="flex flex-wrap items-center gap-2">
          <Hint>{k('issue_emptyQuestion')}</Hint>
          <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => commit(exampleAttrs(t))}>
            {k('fill_example')}
          </button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Field label={k('min_label')}>
          <NumberInput value={data.min} onCommit={(min) => commit({ min })} />
        </Field>
        <Field label={k('max_label')}>
          <NumberInput value={data.max} onCommit={(max) => commit({ max })} />
        </Field>
        <Field label={k('step_label')}>
          <NumberInput value={data.step} onCommit={(step) => commit({ step })} />
        </Field>
      </div>
      {(['minNotBelowMax', 'stepNotPositive', 'stepTooLarge', 'tooManySteps'] as const).filter(has).map((i) => (
        <Hint key={i}>{k(`issue_${i}`)}</Hint>
      ))}

      <div className="grid grid-cols-3 gap-2">
        <Field label={k('answer_label')}>
          <NumberInput value={data.answer} onCommit={(answer) => commit({ answer })} />
        </Field>
        <Field label={k('unit_label')}>
          <CommitInput value={data.unit} onCommit={(unit) => commit({ unit })} placeholder={k('unit_placeholder')} maxLength={16} />
        </Field>
        <Field label={k('tolerance_label')}>
          <NumberInput value={data.tolerancePct} onCommit={(n) => commit({ tolerancePct: Math.max(0, Math.min(100, n)) })} />
        </Field>
      </div>
      {has('answerOutside') && <Hint>{k('issue_answerOutside')}</Hint>}
      {has('answerOffStep') && <Hint>{k('issue_answerOffStep', { value: formatValue(snapGuess(data.answer, range), range.step) })}</Hint>}
      <p className="m-0 text-[11px] leading-snug text-neutral-400">{k('tolerance_hint', { pct: data.tolerancePct })}</p>

      <Field label={k('explanation_label')}>
        <CommitInput multiline value={data.explanation} onCommit={(explanation) => commit({ explanation })} placeholder={k('explanation_placeholder')} aria-label={k('explanation_label')} />
      </Field>
    </div>
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
                    className="absolute inset-y-0 start-0 rounded-full bg-gradient-to-b from-indigo-400 to-indigo-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]"
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
          className="absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border border-black/15 border-b-black/25 bg-gradient-to-b from-white to-neutral-100 shadow-[inset_0_1px_0_#fff,0_2px_3px_rgba(15,23,42,0.18)] rtl:translate-x-1/2 ltr:-translate-x-1/2"
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
