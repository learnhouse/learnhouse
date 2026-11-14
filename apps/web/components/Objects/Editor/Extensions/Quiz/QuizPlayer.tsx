'use client'
/*
 Learner view of the Quiz block, in the block's original look (grey panel,
 lettered chips, blue selection, green/red results, small Submit button).

 A self-check: nothing is sent anywhere, answers live in component state.
 Each row wraps a real (visually hidden) radio button or checkbox, so the
 keyboard works as in any form: Tab between questions, arrow keys inside a
 pick-one group, Space to toggle. On top of the original it shows the
 author's per-option feedback and explanation after submitting, and honours
 the quiz settings (shuffle, attempts, reveal).
*/
import React from 'react'
import dynamic from 'next/dynamic'
import { ArrowCounterClockwise, CheckCircle, Lightbulb, Question as QuestionIcon, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { QUIZ_RESPONSE_SINGLE } from '@/lib/quiz/modes'
import {
  answerLetter,
  attemptsLeft,
  gradeQuiz,
  learnerOrder,
  responseTypeOf,
  selectAnswer,
  type QuizQuestion,
  type QuizSettings,
  type Selection,
} from './quizModel'

const ReactConfetti = dynamic(() => import('react-confetti'), { ssr: false })

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'
function usePrefersReducedMotion() {
  return React.useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {}
      const mq = window.matchMedia(REDUCED_MOTION)
      mq.addEventListener?.('change', onChange)
      return () => mq.removeEventListener?.('change', onChange)
    },
    () => (typeof window !== 'undefined' && !!window.matchMedia ? window.matchMedia(REDUCED_MOTION).matches : false),
    () => false,
  )
}

const newSeed = () => Math.floor(Math.random() * 2 ** 31)

interface Props {
  questions: QuizQuestion[]
  settings: QuizSettings
}

export function QuizPlayer({ questions, settings }: Props) {
  const { t } = useTranslation()
  const groupId = React.useId()
  const reducedMotion = usePrefersReducedMotion()
  const [seed, setSeed] = React.useState(newSeed)
  const [selection, setSelection] = React.useState<Selection>({})
  const [submitted, setSubmitted] = React.useState(false)
  const [attempts, setAttempts] = React.useState(0)
  const resultRef = React.useRef<HTMLDivElement>(null)

  const ordered = React.useMemo(() => learnerOrder(questions, settings, seed), [questions, settings, seed])
  const grade = React.useMemo(() => gradeQuiz(questions, selection), [questions, selection])
  const hasAnyAnswer = Object.values(selection).some((ids) => ids.length > 0)
  const left = attemptsLeft(settings, attempts)
  const canRetry = left === null || left > 0
  const reveal = settings.showCorrectAnswers
  const total = questions.length

  const submit = () => {
    setSubmitted(true)
    setAttempts((n) => n + 1)
    requestAnimationFrame(() => resultRef.current?.focus({ preventScroll: true }))
  }

  // The original reset button: clears the answers, and after a submission
  // starts the next attempt (when one is left).
  const reset = () => {
    setSelection({})
    if (submitted) {
      setSubmitted(false)
      if (settings.shuffleAnswers || settings.shuffleQuestions) setSeed(newSeed())
    }
  }
  const resetDisabled = submitted ? !canRetry : !hasAnyAnswer
  const submitDisabled = submitted || !hasAnyAnswer || total === 0

  const resetLabel = t('editor.blocks.quiz_block.reset_answers')

  return (
    <div data-lhb-panel="" className="bg-neutral-50 rounded-xl px-4 py-3 nice-shadow transition-all ease-linear">
      {submitted && grade.allCorrect && !reducedMotion && (
        <ReactConfetti numberOfPieces={600} recycle={false} style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 60 }} />
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <QuestionIcon weight="duotone" className="text-neutral-400" size={15} />
          <span className="text-[12px] font-semibold text-neutral-500">{t('editor.blocks.quiz')}</span>
          {settings.maxAttempts > 0 && (
            <span className="text-[10px] font-medium text-neutral-400">
              · {t('editor.blocks_v2.quiz.attempt_of', { n: Math.min(attempts + (submitted ? 0 : 1), settings.maxAttempts), total: settings.maxAttempts, defaultValue: 'Attempt {{n}} of {{total}}' })}
            </span>
          )}
        </div>
        {/* Phones get these as a full-width bar under the questions instead. */}
        <div className="flex items-center gap-1 max-md:hidden">
          <button
            type="button"
            onClick={reset}
            disabled={resetDisabled}
            className="p-1 rounded-md text-neutral-400 hover:text-neutral-700 hover:bg-neutral-200 transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-neutral-400 disabled:cursor-not-allowed outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            title={resetLabel}
            aria-label={resetLabel}
          >
            <ArrowCounterClockwise weight="duotone" size={13} />
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitDisabled}
            className={cn(
              'text-xs font-medium px-2.5 py-1 rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
              submitDisabled ? 'bg-neutral-200/60 text-neutral-400 cursor-not-allowed' : 'bg-neutral-700 hover:bg-neutral-800 text-white',
            )}
          >
            {t('editor.blocks.quiz_block.submit')}
          </button>
        </div>
      </div>

      {total === 0 && (
        <div className="bg-white rounded-lg nice-shadow flex items-center justify-center gap-2 py-6">
          <QuestionIcon weight="duotone" className="text-neutral-300" size={20} />
          <p className="text-xs text-neutral-500">{t('editor.blocks.quiz_block.empty_readonly', { defaultValue: 'This quiz has no questions yet.' })}</p>
        </div>
      )}

      {total > 0 && (
        <div className="space-y-3">
          {ordered.map((q, qi) => {
            const single = responseTypeOf(q) === QUIZ_RESPONSE_SINGLE
            const picked = selection[q.question_id] ?? []
            const result = submitted ? grade.results[q.question_id] : null
            const name = `${groupId}-${q.question_id}`
            const showExplanation = submitted && !!q.explanation?.trim() && (reveal || result === 'correct')
            return (
              <fieldset key={q.question_id} className="min-w-0">
                <legend className="contents">
                  <span className="block px-1 text-[11px] font-semibold text-neutral-500 mb-0.5">
                    {t('editor.blocks.quiz_block.question_label', { defaultValue: 'Question' })} {qi + 1}
                  </span>
                  <span className="block px-1 mb-1.5 text-neutral-800 text-sm max-md:text-[15px] font-semibold break-words leading-snug">
                    {q.question || (
                      <span className="text-neutral-300 italic font-normal">{t('editor.blocks.quiz_block.question_placeholder')}</span>
                    )}
                  </span>
                </legend>
                {!single && (
                  <p className="mb-1.5 px-1 text-[10px] font-medium text-neutral-500">{t('editor.blocks.quiz_block.select_all_that_apply')}</p>
                )}

                <div className="space-y-1 max-md:space-y-2">
                  {q.answers.map((a, ai) => {
                    const isSelected = picked.includes(a.answer_id)
                    const isCorrectReveal = submitted && a.correct && (reveal || isSelected)
                    const isWrongSelection = submitted && isSelected && !a.correct
                    const neutralAfter = submitted && !isCorrectReveal && !isWrongSelection
                    const showFeedback = submitted && !!a.feedback?.trim() && (isSelected || (reveal && a.correct))
                    const inputId = `${name}-${a.answer_id}`
                    return (
                      <div key={a.answer_id}>
                        <label
                          htmlFor={inputId}
                          className={cn(
                            'group flex items-center gap-2 rounded-lg nice-shadow px-2 py-1.5 transition-colors select-none',
                            'max-md:min-h-12 max-md:gap-3 max-md:rounded-xl max-md:px-3 max-md:py-2.5',
                            !submitted && 'lh-press cursor-pointer',
                            !submitted && !isSelected && 'bg-white hover:bg-neutral-50',
                            !submitted && isSelected && 'bg-blue-50',
                            isCorrectReveal && 'bg-emerald-50',
                            isWrongSelection && 'bg-red-50',
                            neutralAfter && 'bg-white opacity-60',
                            // Keyboard focus lands on the hidden input: show it on the row.
                            'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-400',
                          )}
                        >
                          <input
                            id={inputId}
                            type={single ? 'radio' : 'checkbox'}
                            name={name}
                            value={a.answer_id}
                            checked={isSelected}
                            disabled={submitted}
                            onChange={() => setSelection((s) => selectAnswer(s, q, a.answer_id))}
                            className="sr-only"
                          />
                          <span
                            aria-hidden
                            className={cn(
                              'shrink-0 w-6 h-6 flex items-center justify-center text-[11px] font-bold transition-colors max-md:w-7 max-md:h-7 max-md:text-xs',
                              // Shape is the affordance: circle = pick one, square = select all.
                              single ? 'rounded-full' : 'rounded-md',
                              !submitted && !isSelected && 'bg-neutral-100 text-neutral-500',
                              !submitted && isSelected && 'bg-blue-500 text-white',
                              isCorrectReveal && 'bg-emerald-500 text-white',
                              isWrongSelection && 'bg-red-500 text-white',
                              neutralAfter && 'bg-neutral-100 text-neutral-400',
                            )}
                          >
                            {answerLetter(ai)}
                          </span>
                          <span
                            className={cn(
                              'flex-1 min-w-0 text-sm max-md:text-[15px] max-md:leading-snug break-words',
                              isCorrectReveal ? 'text-emerald-900 font-medium' : isWrongSelection ? 'text-red-900 font-medium' : 'text-neutral-700',
                            )}
                          >
                            {a.answer || <span className="text-neutral-300 italic">{t('editor.blocks.quiz_block.answer_placeholder')}</span>}
                          </span>
                          {isCorrectReveal && (
                            <>
                              <span className="sr-only">{t('editor.blocks_v2.quiz.correct_answer', 'Correct answer')}</span>
                              <CheckCircle weight="duotone" className="shrink-0 text-emerald-500" size={14} aria-hidden />
                            </>
                          )}
                          {isWrongSelection && (
                            <>
                              <span className="sr-only">{t('editor.blocks_v2.quiz.wrong_pick', 'Your answer, incorrect')}</span>
                              <X weight="duotone" className="shrink-0 text-red-500" size={14} aria-hidden />
                            </>
                          )}
                        </label>
                        {showFeedback && (
                          <p className={cn('mt-0.5 ps-10 text-[11px] leading-snug', a.correct ? 'text-emerald-700' : 'text-red-700')}>{a.feedback}</p>
                        )}
                      </div>
                    )
                  })}
                </div>

                {showExplanation && (
                  <div className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-white nice-shadow px-2 py-1.5 text-xs leading-snug text-neutral-600">
                    <Lightbulb weight="duotone" size={13} className="mt-px shrink-0 text-amber-500" aria-hidden />
                    <span>
                      <span className="sr-only">{t('editor.blocks_v2.quiz.explanation', 'Explanation')}: </span>
                      {q.explanation}
                    </span>
                  </div>
                )}
              </fieldset>
            )
          })}
        </div>
      )}

      {/* Take-mode actions on phones: thumb-sized reset and submit. */}
      {total > 0 && (
        <div className="md:hidden mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={reset}
            disabled={resetDisabled}
            className="lh-press shrink-0 w-11 h-11 flex items-center justify-center rounded-xl bg-white nice-shadow text-neutral-500 disabled:opacity-40 outline-none"
            title={resetLabel}
            aria-label={resetLabel}
          >
            <ArrowCounterClockwise weight="bold" size={18} />
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitDisabled}
            className={cn(
              'lh-press flex-1 h-11 rounded-xl text-[15px] font-semibold transition-colors outline-none',
              submitDisabled ? 'bg-neutral-200/70 text-neutral-400' : 'bg-neutral-900 text-white',
            )}
          >
            {t('editor.blocks.quiz_block.submit')}
          </button>
        </div>
      )}

      {/* Submission message */}
      <div ref={resultRef} tabIndex={-1} aria-live="polite" className="outline-none">
        {submitted && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <div
              className={cn(
                'inline-flex items-center gap-1.5 text-[11px] max-md:text-sm font-medium px-2 py-1 max-md:px-3 max-md:py-2 rounded-md max-md:rounded-lg',
                grade.allCorrect || grade.graded === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700',
              )}
            >
              {grade.allCorrect || grade.graded === 0 ? <CheckCircle weight="duotone" size={12} /> : <X weight="duotone" size={12} />}
              {grade.allCorrect || grade.graded === 0
                ? t('editor.blocks.quiz_block.all_correct')
                : `${t('editor.blocks.quiz_block.some_incorrect')} (${t('editor.blocks_v2.quiz.score', { correct: grade.correct, total: grade.graded, defaultValue: '{{correct}} of {{total}} correct' })})`}
            </div>
            {!grade.allCorrect && !canRetry && (
              <span className="text-[11px] max-md:text-sm font-medium text-neutral-500">{t('editor.blocks_v2.quiz.no_attempts_left', 'No attempts left')}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default QuizPlayer
