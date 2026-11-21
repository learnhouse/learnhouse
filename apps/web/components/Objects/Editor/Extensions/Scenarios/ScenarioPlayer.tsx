'use client'
/*
 The learner's scenario player (also the editor's preview). It renders the
 body of an ExperienceFrame; the state machine lives in scenarioModel.ts
 (startPlay / pickChoice / continuePlay / backPlay). Nothing is written to
 the document.

 Two layouts over the same graph:
   story  a card per step, choices as buttons (the old look, cleaner)
   chat   a messaging-style thread; choices are quick replies
 Both show choice feedback (then Continue), a step counter, an ending card
 with the outcome's tone, a recap of the path taken and Restart.
 Keys: 1-9 or A-Z pick a choice, Enter continues.
*/
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowCounterClockwise, ArrowLeft, ArrowRight, ChatCircleText, CheckCircle, Flag, GitBranch, XCircle } from '@phosphor-icons/react'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import { cn } from '@/lib/utils'
import {
  type EndResult,
  type Outcome,
  type PlayState,
  type ScenarioData,
  type ScenarioDisplay,
  type Visit,
  backPlay,
  choiceLetter,
  continuePlay,
  pickChoice,
  startIdOf,
  startPlay,
  stepById,
  stepNumber,
  stepTitle,
} from './scenarioModel'

const TONE_STYLE: Record<Outcome, { ring: string; chip: string; icon: React.ReactNode }> = {
  success: { ring: 'bg-emerald-50 ring-emerald-600/15', chip: 'bg-emerald-100 text-emerald-700', icon: <CheckCircle weight="duotone" size={28} className="text-emerald-600" /> },
  neutral: { ring: 'bg-sky-50 ring-sky-600/15', chip: 'bg-sky-100 text-sky-700', icon: <Flag weight="duotone" size={26} className="text-sky-600" /> },
  fail: { ring: 'bg-rose-50 ring-rose-600/15', chip: 'bg-rose-100 text-rose-700', icon: <XCircle weight="duotone" size={28} className="text-rose-600" /> },
}

export interface ScenarioPlayerProps {
  data: ScenarioData
  display: ScenarioDisplay
  /** Reports the live line for screen readers and the celebration. */
  onStatus?: (_s: { live: string; celebrate: boolean }) => void
}

export function ScenarioPlayer({ data, display, onStatus }: ScenarioPlayerProps) {
  const { t } = useTranslation()
  const start = startIdOf(data)
  const [state, setState] = React.useState<PlayState>(() => startPlay(data))
  const bodyRef = React.useRef<HTMLDivElement>(null)

  // If the start changes under us (author edits, collaborator), begin again.
  const [lastStart, setLastStart] = React.useState(start)
  if (lastStart !== start) {
    setLastStart(start)
    setState(startPlay(data))
  }

  const step = stepById(data, state.stepId)
  const pendingChoice = state.pending ? step?.options.find((o) => o.id === state.pending) : undefined

  const restart = () => setState(startPlay(data))
  const keepInView = () => requestAnimationFrame(() => bodyRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  const choose = (id: string) => {
    setState((s) => pickChoice(data, s, id))
    keepInView()
  }
  const goOn = () => {
    setState((s) => continuePlay(data, s))
    keepInView()
  }

  // Feedback + celebration for the frame's live region.
  React.useEffect(() => {
    const live = state.ended
      ? endingTitle(t, state.ended)
      : pendingChoice?.feedback
        ? pendingChoice.feedback
        : step
          ? t('activities.experiences.scenarios.step_counter', { n: stepNumber(state), defaultValue: 'Step {{n}}' })
          : ''
    onStatus?.({ live, celebrate: state.ended?.tone === 'success' && state.ended.toned })
  }, [state, pendingChoice, step, t, onStatus])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || !step || state.ended) return
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return
    if (state.pending) {
      if (e.key === 'Enter' && target.tagName !== 'BUTTON') {
        e.preventDefault()
        goOn()
      }
      return
    }
    const n = /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : /^[a-z]$/i.test(e.key) ? e.key.toUpperCase().charCodeAt(0) - 65 : -1
    const choice = step.options[n]
    if (choice) {
      e.preventDefault()
      choose(choice.id)
    }
  }

  if (!step) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center" data-testid="scenario-player">
        <GitBranch weight="duotone" size={24} className="text-neutral-300" />
        <p className="text-sm text-neutral-500">{t('editor.blocks_v2.scenarios.empty_player', 'This scenario has no steps yet.')}</p>
      </div>
    )
  }

  const counter = (
    <span className="inline-flex h-6 items-center rounded-full bg-neutral-100 px-2 text-[11.5px] font-semibold tabular-nums text-neutral-600">
      {t('activities.experiences.scenarios.step_counter', { n: stepNumber(state), defaultValue: 'Step {{n}}' })}
    </span>
  )
  const backButton = state.path.length > 0 || state.pending ? (
    <button
      type="button"
      onClick={() => setState((s) => backPlay(s))}
      className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
    >
      <ArrowLeft size={13} className="rtl:rotate-180" />
      {t('activities.experiences.scenarios.back', 'Back')}
    </button>
  ) : null

  return (
    <div ref={bodyRef} onKeyDown={onKeyDown} data-testid="scenario-player" data-display={display} className="block-scenarios-player">
      {display === 'chat' ? (
        <ChatLayout data={data} state={state} onChoose={choose} onContinue={goOn} onRestart={restart} counter={counter} back={backButton} />
      ) : (
        <StoryLayout data={data} state={state} onChoose={choose} onContinue={goOn} onRestart={restart} counter={counter} back={backButton} />
      )}
    </div>
  )
}

type T = ReturnType<typeof useTranslation>['t']

function endingTitle(t: T, end: EndResult) {
  if (end.title) return end.title
  if (!end.toned) return t('editor.scenarios.complete')
  return t(`activities.experiences.scenarios.ending_${end.tone}_title`)
}

interface LayoutProps {
  data: ScenarioData
  state: PlayState
  onChoose: (_id: string) => void
  onContinue: () => void
  onRestart: () => void
  counter: React.ReactNode
  back: React.ReactNode
}

function ChoiceButtons({ data, state, onChoose, compact }: Pick<LayoutProps, 'data' | 'state' | 'onChoose'> & { compact?: boolean }) {
  const { t } = useTranslation()
  const step = stepById(data, state.stepId)
  if (!step || state.ended) return null
  return (
    <div role="group" aria-label={t('editor.blocks_v2.scenarios.choose', 'Choose a response')} className={cn(compact ? 'flex flex-wrap justify-end gap-2' : 'flex flex-col gap-2')}>
      {step.options.map((option, i) => {
        const picked = state.pending === option.id
        const dimmed = !!state.pending && !picked
        return (
          <button
            key={option.id}
            type="button"
            disabled={!!state.pending}
            aria-pressed={picked || undefined}
            onClick={() => onChoose(option.id)}
            className={cn(
              'group text-start transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lhb-accent-line,rgb(96_165_250/0.5))]',
              compact
                ? 'max-w-full rounded-2xl rounded-ee-md border px-3.5 py-2 text-[14px] font-medium'
                : 'w-full rounded-xl border p-3',
              picked
                ? 'border-[var(--lhb-accent-line,var(--color-blue-300))] bg-[var(--lhb-accent-soft,var(--color-blue-50))] text-[var(--lhb-text,var(--color-blue-900))]'
                : 'border-neutral-200 bg-white text-neutral-700 hover:border-[var(--lhb-accent-line,var(--color-blue-300))] hover:bg-[var(--lhb-accent-soft,var(--color-blue-50))]',
              dimmed && 'opacity-45',
              !state.pending && 'active:scale-[0.99]',
            )}
          >
            {compact ? (
              <span className="break-words">{option.text || '…'}</span>
            ) : (
              <span className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-neutral-100 text-sm font-bold text-neutral-600 transition-colors group-hover:bg-white group-hover:text-[var(--lhb-accent,var(--color-blue-600))]"
                >
                  {choiceLetter(i)}
                </span>
                <span className="min-w-0 flex-1 break-words text-[15px] font-medium">{option.text || '…'}</span>
                <ArrowRight
                  aria-hidden
                  size={16}
                  className="flex-none text-neutral-300 transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--lhb-accent,var(--color-blue-500))] rtl:rotate-180 rtl:group-hover:-translate-x-0.5"
                />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function FeedbackCallout({ text, onContinue }: { text: string; onContinue: () => void }) {
  const { t } = useTranslation()
  const ref = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [])
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-amber-50/70 p-3.5 ring-1 ring-amber-600/10 animate-in fade-in-0 slide-in-from-bottom-1 duration-200 sm:flex-row sm:items-center">
      <p className="m-0 min-w-0 flex-1 whitespace-pre-wrap text-[14px] leading-relaxed text-neutral-800">
        <span className="me-1.5 font-semibold text-amber-800">{t('activities.experiences.scenarios.feedback', 'Feedback')}:</span>
        {text}
      </p>
      <button ref={ref} type="button" onClick={onContinue} className={buttonClass('primary', 'sm', 'flex-none self-end sm:self-auto')}>
        {t('activities.experiences.scenarios.continue', 'Continue')}
        <ArrowRight size={13} weight="bold" className="rtl:rotate-180" />
      </button>
    </div>
  )
}

function StepImage({ url }: { url?: string }) {
  const { t } = useTranslation()
  if (!url) return null
  return (
    <img
      src={url}
      alt={t('editor.scenarios.illustration_alt')}
      className="mb-4 h-48 w-full rounded-xl object-cover ring-1 ring-black/5 max-sm:h-40"
      onError={(e) => {
        e.currentTarget.style.display = 'none'
      }}
    />
  )
}

function StoryLayout({ data, state, onChoose, onContinue, onRestart, counter, back }: LayoutProps) {
  const step = stepById(data, state.stepId)!
  const pending = state.pending ? step.options.find((o) => o.id === state.pending) : undefined
  const showStep = !(state.ended && state.ended.via === 'choice')
  return (
    <div className="flex flex-col gap-3">
      {showStep && (
        <div key={`${step.id}:${state.path.length}`} className="animate-in fade-in-0 duration-200">
          <div className="mb-2 flex items-center gap-2">
            {counter}
            <span className="flex-1" />
            {back}
          </div>
          <StepImage url={step.imageUrl} />
          <p className="m-0 whitespace-pre-wrap text-[16px] leading-relaxed font-medium text-neutral-800 max-sm:text-[15px]" dir="auto">
            {step.text}
          </p>
        </div>
      )}
      <ChoiceButtons data={data} state={state} onChoose={onChoose} />
      {pending?.feedback && <FeedbackCallout text={pending.feedback} onContinue={onContinue} />}
      {state.ended && <EndingCard data={data} state={state} onRestart={onRestart} />}
    </div>
  )
}

function ChatLayout({ data, state, onChoose, onContinue, onRestart, counter, back }: LayoutProps) {
  const { t } = useTranslation()
  const step = stepById(data, state.stepId)!
  const pending = state.pending ? step.options.find((o) => o.id === state.pending) : undefined
  const endRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [state.path.length, state.pending, state.ended])
  const showStep = !(state.ended && state.ended.via === 'choice')

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {counter}
        <span className="flex-1" />
        {back}
      </div>
      <ol className="m-0 flex list-none flex-col gap-2.5 rounded-2xl bg-neutral-50 p-3 ring-1 ring-neutral-200/60 sm:p-4" aria-label={t('activities.experiences.scenarios.conversation', 'Conversation')}>
        {state.path.map((v, i) => (
          <React.Fragment key={i}>
            <Bubble side="them" text={stepById(data, v.stepId)?.text ?? ''} image={stepById(data, v.stepId)?.imageUrl} />
            <Bubble side="me" text={v.choiceText} />
            {v.feedback && <Bubble side="note" text={v.feedback} />}
          </React.Fragment>
        ))}
        {showStep && <Bubble key={`${step.id}:${state.path.length}`} side="them" text={step.text} image={step.imageUrl} fresh />}
        {pending && <Bubble side="me" text={pending.text} fresh />}
        <div ref={endRef} />
      </ol>
      {!state.ended && !state.pending && <ChoiceButtons data={data} state={state} onChoose={onChoose} compact />}
      {pending?.feedback && <FeedbackCallout text={pending.feedback} onContinue={onContinue} />}
      {state.ended && <EndingCard data={data} state={state} onRestart={onRestart} />}
    </div>
  )
}

function Bubble({ side, text, image, fresh }: { side: 'them' | 'me' | 'note'; text: string; image?: string; fresh?: boolean }) {
  const { t } = useTranslation()
  if (side === 'note') {
    return (
      <li className={cn('mx-auto max-w-[90%] rounded-lg bg-amber-50 px-3 py-1.5 text-center text-[12.5px] leading-snug text-amber-900 ring-1 ring-amber-600/10', fresh && 'animate-in fade-in-0')}>
        {text}
      </li>
    )
  }
  const me = side === 'me'
  return (
    <li className={cn('flex items-end gap-2', me ? 'justify-end' : 'justify-start', fresh && 'animate-in fade-in-0 slide-in-from-bottom-1 duration-200')}>
      {!me && (
        <span aria-hidden className="mb-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full bg-white text-neutral-500 ring-1 ring-neutral-200">
          <ChatCircleText size={14} weight="duotone" />
        </span>
      )}
      <div
        dir="auto"
        className={cn(
          'max-w-[82%] whitespace-pre-wrap break-words px-3.5 py-2 text-[14px] leading-relaxed',
          me
            ? 'rounded-2xl rounded-ee-md bg-[var(--lhb-accent,var(--color-blue-600))] text-white'
            : 'rounded-2xl rounded-es-md bg-white text-neutral-800 shadow-[0_1px_1px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.06)]',
        )}
      >
        <span className="sr-only">{me ? t('activities.experiences.scenarios.you', 'You') : t('activities.experiences.scenarios.narrator', 'Story')}: </span>
        {image && !me ? (
                <img src={image} alt="" className="mb-2 max-h-40 w-full rounded-lg object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} />
        ) : null}
        {text || '…'}
      </div>
    </li>
  )
}

function EndingCard({ data, state, onRestart }: { data: ScenarioData; state: PlayState; onRestart: () => void }) {
  const { t } = useTranslation()
  const end = state.ended!
  const tone = TONE_STYLE[end.tone]
  const body = !end.toned ? t('editor.scenarios.complete_message') : t(`activities.experiences.scenarios.ending_${end.tone}_body`)
  return (
    <div className="rounded-2xl bg-white p-5 text-center ring-1 ring-neutral-200/80 animate-in fade-in-0 zoom-in-95 duration-200 sm:p-6" data-testid="scenario-ending" data-tone={end.tone}>
      <div className={cn('mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full ring-1', tone.ring)}>{tone.icon}</div>
      <h4 className="m-0 text-center text-lg font-bold text-neutral-900">{endingTitle(t, end)}</h4>
      <p className="mx-auto mt-1.5 mb-0 max-w-md text-center text-[14px] leading-relaxed text-neutral-600">{body}</p>
      <PathRecap data={data} path={state.path} />
      <button type="button" onClick={onRestart} className={buttonClass('primary', 'sm', 'mt-5')}>
        <ArrowCounterClockwise size={14} weight="bold" />
        {t('activities.experiences.scenarios.restart', 'Restart')}
      </button>
    </div>
  )
}

function PathRecap({ data, path }: { data: ScenarioData; path: Visit[] }) {
  const { t } = useTranslation()
  if (path.length === 0) return null
  return (
    <div className="mt-4 text-start">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{t('activities.experiences.scenarios.your_path', 'Your path')}</div>
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {path.map((v, i) => {
          const title = stepTitle(stepById(data, v.stepId))
          return (
            <li key={i} className="flex gap-2.5 rounded-lg bg-neutral-50 px-3 py-2 text-[13px]">
              <span aria-hidden className="mt-px flex h-5 min-w-5 flex-none items-center justify-center rounded-full bg-white text-[10.5px] font-semibold tabular-nums text-neutral-500 ring-1 ring-neutral-200">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                {title && <span className="block truncate text-[12px] text-neutral-400">{title}</span>}
                <span className="block break-words font-medium text-neutral-800">{v.choiceText || '…'}</span>
                {v.feedback && <span className="mt-0.5 block break-words text-[12.5px] text-neutral-500">{v.feedback}</span>}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export default ScenarioPlayer
