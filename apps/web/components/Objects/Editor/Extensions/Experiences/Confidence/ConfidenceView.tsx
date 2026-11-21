'use client'
/*
 "Confidence check" (node expConfidence): answer, say how sure you are, then
 see the result. At the end a small calibration chart shows how often each
 level of confidence was right, with plain-language takeaways.

 Author: edit in place, one question card at a time: prompt and options
 edited where they sit, a check badge marks the right option, the
 explanation sits where learners read it. Prev / next / "+ Add question".

 Learner: pick an option (tap, or keys 1–4), pick a confidence (Guessing /
 Fairly sure / Certain: tap, Q / W / E, or arrow keys in the group), then
 "Lock in" (or Enter). The options turn ✓ / ✗ and the explanation shows;
 Next moves on. The end screen grows the calibration bars in.
*/
import React from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { ArrowRight, CellSignalFull, CellSignalLow, CellSignalMedium, Check, Target, WarningCircle, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
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
  CONFIDENCE_LEVELS,
  CONFIDENCE_LIMITS,
  addOption,
  addQuestion,
  calibration,
  insights,
  isPlayable,
  judge,
  normalizeConfidence,
  playableConfidence,
  removeOption,
  removeQuestion,
  scoreConfidence,
  updateQuestion,
  validateConfidence,
  type ConfidenceAnswer,
  type ConfidenceData,
  type ConfidenceLevel,
  type ConfidenceQuestion,
  type Insight,
} from './confidenceModel'
import { InlineHint, NotReady, ResultIcon, contentKey } from '../Sort/kit'

const TONE = 'people' as const

/** One look per confidence level: an icon (signal bars) plus a restrained colour. */
const LEVEL: Record<ConfidenceLevel, { icon: React.ComponentType<any>; text: string; bar: string; key: string }> = {
  guess: { icon: CellSignalLow, text: 'text-amber-700', bar: 'from-amber-400/75 to-amber-500/75', key: 'q' },
  fair: { icon: CellSignalMedium, text: 'text-sky-700', bar: 'from-sky-400/70 to-sky-500/70', key: 'w' },
  certain: { icon: CellSignalFull, text: 'text-indigo-700', bar: 'from-indigo-400/70 to-indigo-500/70', key: 'e' },
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

export default function ConfidenceView(props: NodeViewProps) {
  const { t } = useTranslation()
  const editable = useExperienceEditable(props)
  useEnsureBlockId(props, editable)
  const [attrs, commit] = useLiveAttrs(props)
  const data = React.useMemo(() => normalizeConfidence(attrs), [attrs])
  const [preview, setPreview] = React.useState(false)
  const frame: Frame = {
    tone: TONE,
    icon: <Target weight="duotone" />,
    editable,
    preview,
    onPreviewChange: setPreview,
    nodeView: props,
    label: t('editor.experiences.confidence.title', 'Confidence check'),
  }
  const playable = React.useMemo(() => playableConfidence(data), [data])
  return (
    <NodeViewWrapper className="block-exp-confidence">
      {editable && !preview ? (
        <ConfidenceEditor data={data} commit={commit} frame={frame} />
      ) : (
        <ConfidencePlayer key={contentKey(playable.questions)} data={playable} frame={frame} source={props} />
      )}
    </NodeViewWrapper>
  )
}

// ─── Author: edit in place ──────────────────────────────────────────────────
// One question card at a time, as learners see it: the prompt and options are
// edited where they sit, the check badge marks the right option, and the
// explanation sits where learners read it after locking in. Prev / next and
// "+ Add question" move through the check.

const ISSUE_FALLBACK: Record<string, string> = {
  too_few_questions: 'Add at least 1 question.',
  too_many_questions: 'Use at most 10 questions; learners only see the first 10.',
  empty_prompt: 'Write the question.',
  too_few_options: 'Give at least 2 options.',
  too_many_options: 'Use at most 4 options; learners only see the first 4.',
  empty_option: 'An option is empty; learners will not see it.',
  no_explanation: 'Add a short explanation: it is what learners learn from.',
}

function ConfidenceEditor({ data, commit, frame }: { data: ConfidenceData; commit: (_p: CommitPatch<Record<string, any>>) => void; frame: Frame }) {
  const { t } = useTranslation()
  const k = (key: string, fallback: string, o: Record<string, unknown> = {}) => t(`editor.experiences.confidence.${key}`, { ...o, defaultValue: fallback })
  const a = (key: string, fallback: string, o: Record<string, unknown> = {}) => t(`activities.experiences.confidence.${key}`, { ...o, defaultValue: fallback })
  const levelLabel = useLevelLabel()
  const issues = React.useMemo(() => validateConfidence(data), [data])
  const issueText = (code: string) => t(`editor.experiences.confidence.issues.${code}`, ISSUE_FALLBACK[code] ?? code)
  const edit = (fn: (_d: ConfidenceData) => ConfidenceData) => commit((live) => ({ questions: fn(normalizeConfidence(live)).questions }))
  const canRemove = data.questions.length > CONFIDENCE_LIMITS.minQuestions
  const [index, setIndex] = React.useState(0)
  const [live, setLive] = React.useState('')
  const count = data.questions.length
  const i = Math.min(index, Math.max(0, count - 1))
  const q = data.questions[i]
  const rootRef = React.useRef<HTMLDivElement>(null)
  const focusLater = (sel: string) => requestAnimationFrame(() => requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(sel)?.focus()))
  const questionOf = (n: number) => a('question_of', 'Question {{n}} of {{total}}', { n, total: count })

  const go = (n: number) => {
    const next = Math.max(0, Math.min(count - 1, n))
    setIndex(next)
    setLive(questionOf(next + 1))
  }
  const add = () => {
    edit((d) => addQuestion(d, newId()))
    setIndex(count)
    focusLater('[data-prompt] textarea')
  }
  const remove = () => {
    if (!q) return
    edit((d) => removeQuestion(d, q.id))
    setIndex(data.questions[i + 1] ? i : Math.max(0, i - 1))
  }
  const setOption = (oi: number, v: string) =>
    edit((d) => {
      const liveOptions = d.questions.find((x) => x.id === q.id)?.options ?? q.options
      return updateQuestion(d, q.id, { options: liveOptions.map((o, j) => (j === oi ? v : o)) })
    })

  const blockIssues = issues.filter((x) => !x.id)
  const rowIssues = q ? issues.filter((x) => x.id === q.id) : []

  return (
    <ExperienceFrame
      {...frame}
      wysiwyg
      title={data.title}
      onTitleChange={(title) => commit({ title })}
      titlePlaceholder={k('title_placeholder', 'Name this check')}
      instructions={a('instructions', 'Answer, then say how sure you are.')}
      footer={<AnswerKeyHint />}
      live={live}
    >
      <div ref={rootRef} className="flex flex-col gap-4">
        {blockIssues.map((x) => (
          <InlineHint key={x.code} severity={x.severity}>
            {issueText(x.code)}
          </InlineHint>
        ))}
        {q && (
          <div className={cn('relative flex flex-col gap-4', EDIT_OBJECT)}>
            <div data-prompt="" className="flex flex-col gap-1">
              <span className="text-[12px] font-medium tabular-nums text-neutral-500">{questionOf(i + 1)}</span>
              <InlineText
                value={q.prompt}
                onCommit={(prompt) => edit((d) => updateQuestion(d, q.id, { prompt }))}
                ariaLabel={k('prompt_label', 'Question {{n}}', { n: i + 1 })}
                placeholder={k('prompt_placeholder', 'Question {{n}}', { n: i + 1 })}
                maxLength={240}
                className="text-[16px] leading-snug font-semibold text-neutral-900 [overflow-wrap:anywhere]"
              />
            </div>

            <div role="group" aria-label={k('correct_group', 'Right answer for question {{n}}', { n: i + 1 })} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {q.options.map((opt, oi) => {
                const isAnswer = q.answer === oi
                return (
                  <div key={oi} data-option={oi} className={cn('lh-exp-raised relative flex min-h-12 items-center gap-2.5 rounded-xl px-3 py-2.5 text-start text-[14px] font-medium text-neutral-800', EDIT_OBJECT)}>
                    <span aria-hidden className={cn('inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[12px] font-bold', isAnswer ? 'bg-emerald-500 text-white' : 'lh-exp-well text-neutral-500')}>
                      {isAnswer ? <Check size={12} weight="bold" /> : oi + 1}
                    </span>
                    <InlineText
                      value={opt}
                      onCommit={(v) => setOption(oi, v)}
                      ariaLabel={k('option_label', 'Option {{n}}', { n: oi + 1 })}
                      placeholder={k('option_placeholder', 'Option {{n}}', { n: oi + 1 })}
                      maxLength={160}
                      className="min-w-0 flex-1 [overflow-wrap:anywhere]"
                    />
                    <CorrectMark checked={isAnswer} onChange={() => edit((d) => updateQuestion(d, q.id, { answer: oi }))} label={k('mark_correct', 'Mark option {{n}} as the right answer', { n: oi + 1 })} />
                    <RemoveX
                      floating
                      disabled={q.options.length <= CONFIDENCE_LIMITS.minOptions}
                      onClick={() => {
                        edit((d) => removeOption(d, q.id, oi))
                        focusLater(`[data-option="${Math.max(0, oi - 1)}"] textarea`)
                      }}
                      label={k('remove_option', 'Remove option {{n}}', { n: oi + 1 })}
                    />
                  </div>
                )
              })}
              {q.options.length < CONFIDENCE_LIMITS.maxOptions && (
                <AddGhost
                  onClick={() => {
                    edit((d) => addOption(d, q.id))
                    focusLater(`[data-option="${q.options.length}"] textarea`)
                  }}
                  className="min-h-12 rounded-xl px-3 text-[14px]"
                >
                  {k('add_option', 'Add option')}
                </AddGhost>
              )}
            </div>

            {/* What learners use next, inert here. */}
            <div aria-hidden className="pointer-events-none flex flex-col gap-2 opacity-70">
              <span className="text-[13px] font-medium text-neutral-600">{a('how_sure', 'How sure are you?')}</span>
              <div className="lh-exp-well grid grid-cols-3 gap-1.5 rounded-2xl p-1.5">
                {CONFIDENCE_LEVELS.map((lv) => {
                  const Icon = LEVEL[lv].icon
                  return (
                    <span key={lv} className="lh-exp-raised flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 py-1.5 text-[12.5px] font-medium text-neutral-600 sm:flex-row sm:gap-1.5 sm:text-[13px]">
                      <Icon size={16} weight="bold" className="shrink-0" />
                      <span className="min-w-0 text-center leading-tight [overflow-wrap:anywhere]">{levelLabel(lv)}</span>
                    </span>
                  )
                })}
              </div>
            </div>

            {/* Shown after locking in. */}
            <div className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-[13px] leading-relaxed text-emerald-900">
              <Check size={16} weight="bold" className="mt-0.5 shrink-0 text-emerald-600" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="font-semibold [overflow-wrap:anywhere]">{a('right_answer', 'Right answer: {{answer}}', { answer: q.options[q.answer] || '…' })}</div>
                <InlineText
                  multiline
                  value={q.explanation}
                  onCommit={(explanation) => edit((d) => updateQuestion(d, q.id, { explanation }))}
                  ariaLabel={k('explanation_label', 'Explanation for question {{n}}', { n: i + 1 })}
                  placeholder={k('explanation_placeholder', 'Why this is the right answer (shown after locking in)')}
                  maxLength={500}
                  className="mt-1 text-neutral-700 [overflow-wrap:anywhere]"
                />
              </div>
            </div>
            <RemoveX floating disabled={!canRemove} onClick={remove} label={k('remove_question', 'Remove question {{n}}', { n: i + 1 })} className="-top-1 -end-1" />
          </div>
        )}
        {rowIssues.map((x) => (
          <InlineHint key={x.code} severity={x.severity}>
            {issueText(x.code)}
          </InlineHint>
        ))}
        <CardNav
          count={count}
          index={i}
          onGo={go}
          onAdd={add}
          canAdd={count < CONFIDENCE_LIMITS.maxQuestions}
          addLabel={k('add_question', 'Add question')}
          itemLabel={questionOf}
          flagged={(n) => issues.some((x) => x.id === data.questions[n]?.id)}
          prevLabel={k('prev_question', 'Previous question')}
          nextLabel={k('next_question', 'Next question')}
        />
      </div>
    </ExperienceFrame>
  )
}

// ─── Learner ────────────────────────────────────────────────────────────────

function useLevelLabel() {
  const { t } = useTranslation()
  return (level: ConfidenceLevel) =>
    level === 'guess'
      ? t('activities.experiences.confidence.level_guess', 'Guessing')
      : level === 'fair'
        ? t('activities.experiences.confidence.level_fair', 'Fairly sure')
        : t('activities.experiences.confidence.level_certain', 'Certain')
}

function ConfidencePlayer({ data, frame, source }: { data: ConfidenceData; frame: Frame; source: NodeViewProps }) {
  const { t } = useTranslation()
  const k = (key: string, fallback: string, o: Record<string, unknown> = {}) => t(`activities.experiences.confidence.${key}`, { ...o, defaultValue: fallback })
  const levelLabel = useLevelLabel()
  const memory = useExperienceMemory(data.blockId, source)
  const [index, setIndex] = React.useState(0)
  const [choice, setChoice] = React.useState<number | null>(null)
  const [level, setLevel] = React.useState<ConfidenceLevel | null>(null)
  const [answers, setAnswers] = React.useState<ConfidenceAnswer[]>([])
  const [done, setDone] = React.useState(false)
  const [live, setLive] = React.useState('')
  const [best, setBest] = React.useState<number>(() => memory.read<number>('best', 0))
  const rootRef = React.useRef<HTMLDivElement>(null)
  const nextRef = React.useRef<HTMLButtonElement>(null)

  const total = data.questions.length
  const question: ConfidenceQuestion | undefined = data.questions[index]
  const last = answers.find((a) => a.questionId === question?.id) ?? null
  const locked = !!last
  const result = React.useMemo(() => scoreConfidence(answers, total), [answers, total])

  // After locking in, the Next key takes focus (only if focus was already inside the block).
  React.useEffect(() => {
    if (locked && rootRef.current?.contains(document.activeElement)) nextRef.current?.focus({ preventScroll: true })
  }, [locked])

  if (!isPlayable(data) || !question) {
    return (
      <ExperienceFrame {...frame} title={data.title}>
        <NotReady>{k('not_ready', 'This activity is not ready yet.')}</NotReady>
      </ExperienceFrame>
    )
  }

  const lockIn = () => {
    if (locked || choice === null || !level) return
    const a = judge(question, choice, level)
    setAnswers((prev) => [...prev, a])
    buzz(a.correct ? 'correct' : 'wrong')
    setLive(
      a.correct
        ? k('live_correct', 'Correct. You said: {{level}}.', { level: levelLabel(level) })
        : k('live_wrong', 'Not quite. The answer was {{answer}}.', { answer: question.options[question.answer] }),
    )
  }

  const next = () => {
    if (!locked) return
    if (index + 1 >= total) {
      const r = scoreConfidence(answers, total)
      setDone(true)
      setLive(k('result', '{{correct}} of {{total}} correct', { correct: r.correct, total: r.total }))
      if (r.stars > best) {
        setBest(r.stars)
        memory.write('best', r.stars)
      }
      return
    }
    setIndex((i) => i + 1)
    setChoice(null)
    setLevel(null)
    setLive(k('question_of', 'Question {{n}} of {{total}}', { n: index + 2, total }))
    window.requestAnimationFrame(() => {
      if (rootRef.current?.contains(document.activeElement) || document.activeElement === document.body) {
        rootRef.current?.querySelector<HTMLElement>('[data-conf-option]')?.focus({ preventScroll: true })
      }
    })
  }

  const reset = () => {
    setIndex(0)
    setChoice(null)
    setLevel(null)
    setAnswers([])
    setDone(false)
    setLive('')
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (done || e.altKey || e.ctrlKey || e.metaKey) return
    if (!locked) {
      // Physical keys (e.code), so they work on any keyboard layout.
      const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)
      const n = digit ? Number(digit[1]) : Number(e.key)
      if (Number.isInteger(n) && n >= 1 && n <= question.options.length) {
        e.preventDefault()
        setChoice(n - 1)
        return
      }
      const lv = CONFIDENCE_LEVELS.find((l) => e.code === `Key${LEVEL[l].key.toUpperCase()}`)
      if (lv) {
        e.preventDefault()
        setLevel(lv)
        return
      }
    }
    if (e.key === 'Enter') {
      if (!locked && choice !== null && level) {
        e.preventDefault()
        lockIn()
      } else if (locked) {
        e.preventDefault()
        next()
      }
    }
  }

  const onLevelKey = (e: React.KeyboardEvent<HTMLElement>, current: ConfidenceLevel) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
    e.preventDefault()
    e.stopPropagation()
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl'
    let step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1
    if (rtl && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) step = -step
    const i = Math.min(CONFIDENCE_LEVELS.length - 1, Math.max(0, CONFIDENCE_LEVELS.indexOf(current) + step))
    const lv = CONFIDENCE_LEVELS[i]
    setLevel(lv)
    e.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-conf-level="${lv}"]`)?.focus()
  }

  const footer = (
    <ExperienceFooter
      progress={done ? undefined : { done: answers.length, total }}
      stars={done ? result.stars : undefined}
      score={done ? `${result.correct} / ${result.total}` : undefined}
      onRetry={done || answers.length > 0 ? reset : undefined}
    >
      {!done && best > 0 && (
        <span className="flex items-center gap-1.5 text-xs text-neutral-500">
          {k('best', 'Best')}
          <Stars value={best as 0 | 1 | 2 | 3} size={13} />
        </span>
      )}
    </ExperienceFooter>
  )

  return (
    <ExperienceFrame
      {...frame}
      title={data.title}
      instructions={k('instructions', 'Answer, then say how sure you are.')}
      footer={footer}
      celebrate={done && result.perfect}
      live={live}
    >
      <div ref={rootRef} onKeyDown={onKeyDown}>
        {done ? (
          <ConfidenceResults data={data} answers={answers} />
        ) : (
          <div key={question.id} className="lh-exp-slide-in flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-[12px] font-medium tabular-nums text-neutral-500">{k('question_of', 'Question {{n}} of {{total}}', { n: index + 1, total })}</span>
              <h4 className="m-0 text-[16px] leading-snug font-semibold text-neutral-900 [overflow-wrap:anywhere]">{question.prompt}</h4>
            </div>

            <div role="radiogroup" aria-label={question.prompt} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {question.options.map((opt, i) => {
                const isAnswer = i === question.answer
                const picked = choice === i
                const state = !locked ? (picked ? 'picked' : 'idle') : isAnswer ? 'right' : picked ? 'wrong' : 'dim'
                return (
                  <button
                    key={i}
                    type="button"
                    role="radio"
                    aria-checked={picked}
                    data-conf-option=""
                    data-picked={state === 'picked' ? 'true' : undefined}
                    aria-disabled={locked ? true : undefined}
                    onClick={() => !locked && setChoice(i)}
                    data-result={state === 'right' ? 'correct' : state === 'wrong' ? 'wrong' : undefined}
                    className={cn(
                      'lh-exp-raised flex min-h-12 items-center gap-2.5 rounded-xl px-3 py-2.5 text-start text-[14px] font-medium outline-none',
                      !locked && 'lh-exp-press',
                      state === 'idle' && 'text-neutral-800',
                      state === 'picked' && 'text-indigo-700',
                      state === 'wrong' && 'lh-exp-wrong-shake',
                      state === 'dim' && 'text-neutral-400 opacity-60',
                      locked && 'cursor-default',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[12px] font-bold',
                        state === 'right' ? 'bg-emerald-500 text-white' : state === 'wrong' ? 'bg-rose-500 text-white' : state === 'picked' ? 'bg-indigo-600 text-white' : 'lh-exp-well text-neutral-500',
                      )}
                    >
                      {state === 'right' ? <Check size={12} weight="bold" /> : state === 'wrong' ? <X size={12} weight="bold" /> : i + 1}
                    </span>
                    <span className="min-w-0 [overflow-wrap:anywhere]">{opt}</span>
                    {state === 'right' && <span className="sr-only">{k('correct', 'Correct')}</span>}
                    {state === 'wrong' && <span className="sr-only">{k('wrong', 'Not quite')}</span>}
                  </button>
                )
              })}
            </div>

            {!locked ? (
              <div className="flex flex-col gap-2">
                <span id={`conf-how-${question.id}`} className="text-[13px] font-medium text-neutral-600">
                  {k('how_sure', 'How sure are you?')}
                </span>
                <div role="radiogroup" aria-labelledby={`conf-how-${question.id}`} className="lh-exp-well grid grid-cols-3 gap-1.5 rounded-2xl p-1.5">
                  {CONFIDENCE_LEVELS.map((lv) => {
                    const Icon = LEVEL[lv].icon
                    const on = level === lv
                    return (
                      <button
                        key={lv}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        tabIndex={on || (!level && lv === 'guess') ? 0 : -1}
                        data-conf-level={lv}
                        data-picked={on ? 'true' : undefined}
                        onClick={() => setLevel(lv)}
                        onKeyDown={(e) => onLevelKey(e, lv)}
                        className={cn(
                          'lh-exp-raised lh-exp-press flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 py-1.5 text-[12.5px] font-medium outline-none sm:flex-row sm:gap-1.5 sm:text-[13px]',
                          on ? cn(LEVEL[lv].text, 'lh-exp-tint') : 'text-neutral-600',
                        )}
                      >
                        <Icon size={16} weight={on ? 'fill' : 'bold'} aria-hidden className="shrink-0" />
                        <span className="min-w-0 text-center leading-tight [overflow-wrap:anywhere]">{levelLabel(lv)}</span>
                        <kbd aria-hidden className="hidden rounded px-1 text-[10px] font-medium text-neutral-400 sm:inline">
                          {LEVEL[lv].key.toUpperCase()}
                        </kbd>
                      </button>
                    )
                  })}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <button type="button" onClick={lockIn} disabled={choice === null || !level} className="lh-exp-key">
                    {k('lock_in', 'Lock in')}
                  </button>
                  {(choice === null || !level) && (
                    <span className="text-[13px] text-neutral-500">
                      {choice === null ? k('pick_answer', 'Pick an answer and how sure you are.') : k('pick_level', 'Now say how sure you are.')}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              last && (
                <div className="lh-exp-slide-in flex flex-col gap-3">
                  <div className={cn('flex items-start gap-2 rounded-xl px-3 py-2.5 text-[13px] leading-relaxed', last.correct ? 'bg-emerald-50 text-emerald-900' : 'bg-rose-50/80 text-rose-900')}>
                    <span className="mt-0.5">
                      <ResultIcon ok={last.correct} size={16} label="" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-semibold">
                        <span>{last.correct ? k('correct', 'Correct') : k('wrong', 'Not quite')}</span>
                        <LevelPill level={last.level} />
                      </div>
                      {!last.correct && (
                        <div className="mt-0.5 font-medium [overflow-wrap:anywhere]">{k('right_answer', 'Right answer: {{answer}}', { answer: question.options[question.answer] })}</div>
                      )}
                      {question.explanation && <p className="m-0 mt-1 text-neutral-700 [overflow-wrap:anywhere]">{question.explanation}</p>}
                    </div>
                  </div>
                  <div>
                    <button ref={nextRef} type="button" onClick={next} className="lh-exp-key">
                      {index + 1 >= total ? k('see_results', 'See results') : k('next', 'Next')}
                      <ArrowRight size={14} weight="bold" aria-hidden className="rtl:rotate-180" />
                    </button>
                  </div>
                </div>
              )
            )}
            <p className="m-0 hidden text-[12px] text-neutral-400 sm:block">{k('keyboard_hint', 'Keys: 1–4 pick an answer, Q W E set how sure you are, Enter locks in.')}</p>
          </div>
        )}
      </div>
    </ExperienceFrame>
  )
}

function LevelPill({ level }: { level: ConfidenceLevel }) {
  const levelLabel = useLevelLabel()
  const Icon = LEVEL[level].icon
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 text-[11.5px] font-medium ring-1 ring-black/5', LEVEL[level].text)}>
      <Icon size={12} weight="fill" aria-hidden />
      {levelLabel(level)}
    </span>
  )
}

const INSIGHT_FALLBACK: Record<string, string> = {
  certain_wrong: 'Certain but wrong: {{n}}. Those are worth reviewing first.',
  guess_right: 'Right while guessing: {{n}}. Lucky, or you know more than you think.',
  well_calibrated: 'Your confidence matched your answers well.',
  overconfident: 'You felt surer than your answers showed. Slow down on the tricky ones.',
  underconfident: 'You knew more than you thought. Trust yourself a little more.',
  all_right: 'All right, and you knew it. Nicely calibrated.',
}

function ConfidenceResults({ data, answers }: { data: ConfidenceData; answers: ConfidenceAnswer[] }) {
  const { t } = useTranslation()
  const k = (key: string, fallback: string, o: Record<string, unknown> = {}) => t(`activities.experiences.confidence.${key}`, { ...o, defaultValue: fallback })
  const levelLabel = useLevelLabel()
  const stats = calibration(answers)
  const notes = insights(answers)
  const result = scoreConfidence(answers, data.questions.length)
  const byId = new Map(answers.map((a) => [a.questionId, a]))

  return (
    <div className="flex flex-col gap-5">
      <p className={cn('m-0 flex items-center gap-2 text-[14px] font-medium', result.perfect ? 'text-emerald-700' : 'text-neutral-700')}>
        <ResultIcon ok={result.perfect} size={16} label="" />
        {k('result', '{{correct}} of {{total}} correct', { correct: result.correct, total: result.total })}
      </p>

      <section className="flex flex-col gap-3" aria-labelledby={`conf-cal-${data.blockId || 'x'}`}>
        <div>
          <h4 id={`conf-cal-${data.blockId || 'x'}`} className="m-0 text-[14px] font-semibold text-neutral-800">
            {k('calibration_title', 'How well your confidence matched')}
          </h4>
          <p className="m-0 text-[12.5px] text-neutral-500">{k('calibration_hint', 'How often you were right at each level of confidence.')}</p>
        </div>
        <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0 sm:gap-4">
          {stats.map((s, i) => {
            const Icon = LEVEL[s.level].icon
            const pct = s.accuracy === null ? 0 : Math.round(s.accuracy * 100)
            const label = s.total
              ? k('bar_count', '{{correct}} of {{total}} right', { correct: s.correct, total: s.total })
              : k('not_used', 'Not used')
            return (
              <li key={s.level} className="flex min-w-0 flex-col items-center gap-1.5" aria-label={`${levelLabel(s.level)}: ${label}`}>
                <span aria-hidden className="lh-exp-grow-label h-4 text-center text-[12px] font-semibold tabular-nums text-neutral-700" style={{ '--exp-i': i } as React.CSSProperties}>
                  {s.total > 0 ? `${pct}%` : ''}
                </span>
                <div aria-hidden className="lh-exp-well relative flex h-24 w-full max-w-14 items-end overflow-hidden rounded-xl p-1">
                  {s.total > 0 && (
                    <div
                      className={cn('lh-exp-grow w-full rounded-lg bg-gradient-to-b shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]', LEVEL[s.level].bar)}
                      style={{ height: `max(${pct}%, 6px)`, '--exp-i': i } as React.CSSProperties}
                    />
                  )}
                </div>
                <span className={cn('flex min-w-0 items-center gap-1 text-center text-[12.5px] font-semibold leading-tight', LEVEL[s.level].text)}>
                  <Icon size={13} weight="fill" aria-hidden className="shrink-0" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{levelLabel(s.level)}</span>
                </span>
                <span className="text-center text-[11.5px] tabular-nums text-neutral-500">{label}</span>
              </li>
            )
          })}
        </ul>
        {notes.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {notes.map((n: Insight) => (
              <li
                key={n.code}
                className={cn(
                  'lh-exp-reveal-in flex items-start gap-2 rounded-xl px-3 py-2 text-[13px] leading-relaxed',
                  n.tone === 'warn' ? 'bg-amber-50 text-amber-900' : n.tone === 'good' ? 'bg-emerald-50 text-emerald-900' : 'bg-sky-50 text-sky-900',
                )}
                style={{ '--exp-i': 3 } as React.CSSProperties}
              >
                {n.tone === 'warn' ? (
                  <WarningCircle size={15} weight="fill" aria-hidden className="mt-0.5 shrink-0 text-amber-600" />
                ) : n.tone === 'good' ? (
                  <Check size={15} weight="bold" aria-hidden className="mt-0.5 shrink-0 text-emerald-600" />
                ) : (
                  <Target size={15} weight="bold" aria-hidden className="mt-0.5 shrink-0 text-sky-600" />
                )}
                <span>{t(`activities.experiences.confidence.insight_${n.code}`, { n: n.n, defaultValue: INSIGHT_FALLBACK[n.code] })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h4 className="m-0 text-[14px] font-semibold text-neutral-800">{k('review_title', 'Your answers')}</h4>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {data.questions.map((q) => {
            const a = byId.get(q.id)
            if (!a) return null
            return (
              <li key={q.id} className="flex flex-col gap-1 rounded-xl bg-white p-3 shadow-[0_0_0_1px_var(--exp-edge,rgba(0,0,0,0.08))]">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5">
                    <ResultIcon ok={a.correct} size={15} />
                  </span>
                  <p className="m-0 min-w-0 flex-1 text-[14px] font-medium text-neutral-900 [overflow-wrap:anywhere]">{q.prompt}</p>
                  <LevelPill level={a.level} />
                </div>
                <div className="flex flex-col gap-0.5 ps-6 text-[13px]">
                  {!a.correct && (
                    <span className="text-rose-700 [overflow-wrap:anywhere]">{k('your_answer', 'Your answer: {{answer}}', { answer: q.options[a.choice] ?? '' })}</span>
                  )}
                  <span className="text-emerald-800 [overflow-wrap:anywhere]">{k('right_answer', 'Right answer: {{answer}}', { answer: q.options[q.answer] })}</span>
                  {q.explanation && <span className="text-neutral-600 [overflow-wrap:anywhere]">{q.explanation}</span>}
                </div>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
