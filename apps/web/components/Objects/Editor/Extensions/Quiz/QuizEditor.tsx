'use client'
/*
 Authoring view of the Quiz block, in the block's original look (grey panel,
 uppercase labels, lettered answer chips, small neutral buttons).

 What changed underneath: text commits on blur (DraftText) instead of on
 every keystroke, every write is built from the latest stored questions,
 options and questions reorder by dragging their grip (or arrow keys on it),
 Enter / Backspace add and remove options like a list, and each option can
 carry feedback and each question an explanation. Quiz-wide options sit in a
 small settings popover.
*/
import React from 'react'
import { ChatCircleText, Check, DotsSixVertical, Lightbulb, Plus, Question as QuestionIcon, Trash } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { AIButton } from '@components/Objects/AI/AIBrand'
import { DraftText, type DraftTextHandle } from '../../Blocks/ui/DraftText'
import { dropEdge, usePointerReorder } from '../../Blocks/ui/usePointerReorder'
import { QUIZ_RESPONSE_MULTIPLE, QUIZ_RESPONSE_SINGLE, type QuizResponseType } from '@/lib/quiz/modes'
import {
  MAX_ANSWERS,
  answerLetter,
  hasCorrectAnswer,
  insertAnswer,
  moveAnswer,
  moveItem,
  newAnswer,
  newQuestion,
  removeAnswer,
  responseTypeOf,
  setResponseType,
  toggleCorrect,
  updateAnswer,
  updateQuestion,
  withOptionalText,
  type QuizQuestion,
  type QuizSettings,
} from './quizModel'
import { QuizSettingsPopover } from './QuizSettingsPopover'

type Commit = (_fn: (_qs: QuizQuestion[]) => QuizQuestion[]) => void

interface EditorProps {
  questions: QuizQuestion[]
  settings: QuizSettings
  commit: Commit
  commitSettings: (_s: QuizSettings) => void
  onGenerate: () => void
}

/** Focus a field once React has rendered it (new rows mount a frame later). */
function useFieldFocus() {
  const fields = React.useRef<Record<string, DraftTextHandle | null>>({})
  const focus = React.useCallback((id: string, tries = 6) => {
    const go = (n: number) => {
      const f = fields.current[id]
      if (f) f.focus()
      else if (n > 0) requestAnimationFrame(() => go(n - 1))
    }
    go(tries)
  }, [])
  const register = (id: string) => (el: DraftTextHandle | null) => {
    fields.current[id] = el
  }
  return { focus, register }
}

const GRIP =
  'flex shrink-0 cursor-grab touch-none items-center justify-center rounded text-neutral-300 outline-none transition-opacity hover:text-neutral-500 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-sky-500/40 active:cursor-grabbing'
const ICON_BTN =
  'shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-neutral-400 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40'

export function QuizEditor({ questions, settings, commit, commitSettings, onGenerate }: EditorProps) {
  const { t } = useTranslation()
  const listRef = React.useRef<HTMLDivElement>(null)
  const { focus, register } = useFieldFocus()
  const { drag, gripProps } = usePointerReorder({
    containerRef: listRef,
    count: questions.length,
    onMove: (from, to) => commit((qs) => moveItem(qs, from, to)),
  })

  const addQuestion = () => {
    const q = newQuestion()
    commit((qs) => [...qs, q])
    focus(`q:${q.question_id}`)
  }

  return (
    <div data-lhb-panel="" className="bg-neutral-50 rounded-xl px-4 py-3 nice-shadow transition-all ease-linear max-sm:px-3">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <QuestionIcon weight="duotone" className="text-neutral-400" size={15} />
          <span className="text-[12px] font-semibold text-neutral-500">{t('editor.blocks.quiz')}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <AIButton size="sm" onClick={onGenerate}>
            {t('editor.blocks.quiz_block.generate_with_ai', 'Generate with AI')}
          </AIButton>
          <QuizSettingsPopover settings={settings} onChange={commitSettings} />
          <button
            type="button"
            onClick={addQuestion}
            className="flex items-center gap-1 bg-neutral-200 hover:bg-neutral-300 text-neutral-700 text-xs font-medium px-2.5 py-1 rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
          >
            <Plus weight="duotone" size={12} />
            {t('editor.blocks.quiz_block.add_question')}
          </button>
        </div>
      </div>

      {questions.length === 0 && (
        <div className="bg-white rounded-lg nice-shadow flex items-center justify-center gap-2 py-6">
          <QuestionIcon weight="duotone" className="text-neutral-300" size={20} />
          <p className="text-xs text-neutral-500">
            {t('editor.blocks.quiz_block.empty_editable', { defaultValue: 'No questions yet. Add your first one to get started.' })}
          </p>
        </div>
      )}

      {questions.length > 0 && (
        <div ref={listRef} data-reorder-list="" className="space-y-3">
          {questions.map((q, i) => (
            <QuestionBlock
              key={q.question_id}
              question={q}
              index={i}
              total={questions.length}
              commit={commit}
              register={register}
              focus={focus}
              grip={gripProps(i, q.question_id)}
              dragging={drag?.from === i}
              edge={dropEdge(drag, i)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface QuestionProps {
  question: QuizQuestion
  index: number
  total: number
  commit: Commit
  register: (_id: string) => (_el: DraftTextHandle | null) => void
  focus: (_id: string) => void
  grip: ReturnType<ReturnType<typeof usePointerReorder>['gripProps']>
  dragging: boolean
  edge: 'before' | 'after' | null
}

function QuestionBlock({ question: q, index, total, commit, register, focus, grip, dragging, edge }: QuestionProps) {
  const { t } = useTranslation()
  const qid = q.question_id
  const responseType = responseTypeOf(q)
  const single = responseType === QUIZ_RESPONSE_SINGLE
  const optionsRef = React.useRef<HTMLDivElement>(null)
  const [explanationOpen, setExplanationOpen] = React.useState(false)
  const [openFeedback, setOpenFeedback] = React.useState<Record<string, boolean>>({})
  const explanationShown = explanationOpen || !!q.explanation?.trim()

  const reorder = usePointerReorder({
    containerRef: optionsRef,
    count: q.answers.length,
    onMove: (from, to) => commit((qs) => moveAnswer(qs, qid, from, to)),
  })

  const addOptionAfter = (afterId: string | null) => {
    if (q.answers.length >= MAX_ANSWERS) return
    const a = newAnswer()
    commit((qs) => insertAnswer(qs, qid, afterId, a))
    focus(`a:${a.answer_id}`)
  }

  const removeOption = (answerId: string, focusPrev: boolean) => {
    const idx = q.answers.findIndex((a) => a.answer_id === answerId)
    commit((qs) => removeAnswer(qs, qid, answerId))
    if (focusPrev) {
      const prev = q.answers[idx - 1] ?? q.answers[idx + 1]
      focus(prev ? `a:${prev.answer_id}` : `q:${qid}`)
    }
  }

  return (
    <div
      data-reorder-item=""
      className={cn(
        'group/q rounded-lg transition-[opacity,box-shadow]',
        dragging && 'opacity-50',
        edge === 'before' && 'shadow-[0_-2px_0_0_rgb(16,185,129)]',
        edge === 'after' && 'shadow-[0_2px_0_0_rgb(16,185,129)]',
      )}
    >
      {/* Question header */}
      <div className="flex items-start justify-between gap-2 mb-1.5 px-1">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-neutral-500 mb-0.5">
            {total > 1 && (
              <button
                type="button"
                {...grip}
                aria-label={t('editor.blocks_v2.quiz.drag_question', 'Drag to reorder question')}
                title={t('editor.blocks_v2.quiz.drag_question', 'Drag to reorder question')}
                className={cn(GRIP, '-ms-1 h-4 w-3.5 opacity-0 group-hover/q:opacity-100 max-md:opacity-100')}
              >
                <DotsSixVertical size={12} weight="bold" />
              </button>
            )}
            {t('editor.blocks.quiz_block.question_label', { defaultValue: 'Question' })} {index + 1}
          </div>
          <DraftText
            ref={register(`q:${qid}`)}
            value={q.question}
            maxLength={2000}
            ariaLabel={t('editor.blocks_v2.quiz.question_n', { n: index + 1, defaultValue: 'Question {{n}}' })}
            placeholder={t('editor.blocks.quiz_block.question_placeholder')}
            onCommit={(v) => commit((qs) => updateQuestion(qs, qid, (x) => ({ ...x, question: v })))}
            onEnter={() => focus(q.answers[0] ? `a:${q.answers[0].answer_id}` : `q:${qid}`)}
            className="text-neutral-800 text-sm font-semibold leading-snug placeholder:text-neutral-300"
          />
        </div>
        <button
          type="button"
          onClick={() => commit((qs) => qs.filter((x) => x.question_id !== qid))}
          className={cn(ICON_BTN, 'hover:text-red-500 hover:bg-red-50')}
          title={t('editor.blocks.quiz_block.delete_question', { defaultValue: 'Delete question' })}
          aria-label={t('editor.blocks.quiz_block.delete_question', { defaultValue: 'Delete question' })}
        >
          <Trash weight="duotone" size={12} />
        </button>
      </div>

      {/* Response mode, explanation toggle, missing-key warning */}
      <div className="flex flex-wrap items-center gap-1 mb-1.5 px-1">
        <div role="radiogroup" aria-label={t('editor.blocks_v2.quiz.answer_type', 'Answer type')} className="flex items-center gap-1">
          {([QUIZ_RESPONSE_SINGLE, QUIZ_RESPONSE_MULTIPLE] as QuizResponseType[]).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={responseType === mode}
              onClick={() => responseType !== mode && commit((qs) => setResponseType(qs, qid, mode))}
              className={cn(
                'text-[10px] font-medium px-2 py-0.5 rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40',
                responseType === mode ? 'bg-neutral-800 text-white' : 'bg-neutral-200 text-neutral-600 hover:bg-neutral-300',
              )}
            >
              {mode === QUIZ_RESPONSE_SINGLE
                ? t('editor.blocks.quiz_block.response_type_single')
                : t('editor.blocks.quiz_block.response_type_multiple')}
            </button>
          ))}
        </div>
        {!explanationShown && (
          <button
            type="button"
            onClick={() => {
              setExplanationOpen(true)
              focus(`e:${qid}`)
            }}
            className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-md bg-neutral-200 text-neutral-600 hover:bg-neutral-300 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
          >
            <Lightbulb weight="duotone" size={10} />
            {t('editor.blocks_v2.quiz.add_explanation', 'Explanation')}
          </button>
        )}
        {!hasCorrectAnswer(q) && (
          // Non-blocking: a question with no correct answer is skipped when graded.
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-amber-100 text-amber-700">
            {t('editor.blocks.quiz_block.no_correct_answer_warning')}
          </span>
        )}
      </div>

      {/* Answers */}
      <div ref={optionsRef} data-reorder-list="" className="space-y-1" role="list" aria-label={t('editor.blocks_v2.quiz.options', 'Options')}>
        {q.answers.map((a, ai) => {
          const letter = answerLetter(ai)
          const aEdge = dropEdge(reorder.drag, ai)
          const hasFeedback = !!a.feedback?.trim()
          const feedbackShown = openFeedback[a.answer_id] || hasFeedback
          return (
            <div
              key={a.answer_id}
              role="listitem"
              data-reorder-item=""
              className={cn(
                'group rounded-lg nice-shadow px-2 py-1.5 transition-colors',
                a.correct ? 'bg-emerald-50' : 'bg-white hover:bg-neutral-50',
                reorder.drag?.from === ai && 'opacity-50',
                aEdge === 'before' && 'shadow-[0_-2px_0_0_rgb(16,185,129)]',
                aEdge === 'after' && 'shadow-[0_2px_0_0_rgb(16,185,129)]',
              )}
            >
              <div className="flex items-center gap-2">
                {q.answers.length > 1 && (
                  <button
                    type="button"
                    {...reorder.gripProps(ai, a.answer_id)}
                    aria-label={t('editor.blocks_v2.quiz.drag_option', { letter, defaultValue: 'Drag to reorder option {{letter}}' })}
                    title={t('editor.blocks_v2.quiz.drag_option_short', 'Drag to reorder')}
                    className={cn(GRIP, '-mx-1 h-6 w-3 opacity-0 group-hover:opacity-100 max-md:opacity-100')}
                  >
                    <DotsSixVertical size={12} weight="bold" />
                  </button>
                )}
                {/* Letter chip: one click toggles "correct". Circle = pick one, square = select all. */}
                <button
                  type="button"
                  onClick={() => commit((qs) => toggleCorrect(qs, qid, a.answer_id))}
                  aria-pressed={a.correct}
                  aria-label={
                    a.correct
                      ? t('editor.blocks_v2.quiz.unmark_correct', { letter, defaultValue: 'Option {{letter}} is correct. Click to unmark.' })
                      : t('editor.blocks_v2.quiz.mark_correct', { letter, defaultValue: 'Mark option {{letter}} as correct' })
                  }
                  title={a.correct ? t('editor.blocks.quiz_block.mark_incorrect') : t('editor.blocks.quiz_block.mark_correct')}
                  className={cn(
                    'shrink-0 w-6 h-6 flex items-center justify-center text-[11px] font-bold transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40',
                    single ? 'rounded-full' : 'rounded-md',
                    a.correct ? 'bg-emerald-500 text-white' : 'bg-neutral-100 text-neutral-500 hover:bg-emerald-100 hover:text-emerald-700',
                  )}
                >
                  {a.correct ? <Check weight="bold" size={12} /> : letter}
                </button>
                <div className="flex-1 min-w-0">
                  <DraftText
                    ref={register(`a:${a.answer_id}`)}
                    value={a.answer}
                    multiline={false}
                    maxLength={1000}
                    ariaLabel={t('editor.blocks_v2.quiz.option_n', { letter, defaultValue: 'Option {{letter}}' })}
                    placeholder={t('editor.blocks.quiz_block.answer_placeholder')}
                    onCommit={(v) => commit((qs) => updateAnswer(qs, qid, a.answer_id, { answer: v }))}
                    onEnter={() => {
                      // Like a list: move into the next option while it is still
                      // empty, otherwise start a new one below.
                      const next = q.answers[ai + 1]
                      if (next && !next.answer.trim()) focus(`a:${next.answer_id}`)
                      else addOptionAfter(a.answer_id)
                    }}
                    onEmptyBackspace={q.answers.length > 1 ? () => removeOption(a.answer_id, true) : undefined}
                    className="text-sm leading-6 text-neutral-700"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setOpenFeedback((s) => ({ ...s, [a.answer_id]: !feedbackShown }))
                    if (!feedbackShown) focus(`f:${a.answer_id}`)
                  }}
                  aria-pressed={feedbackShown}
                  aria-label={t('editor.blocks_v2.quiz.feedback_toggle', { letter, defaultValue: 'Feedback for option {{letter}}' })}
                  title={t('editor.blocks_v2.quiz.feedback', 'Feedback')}
                  className={cn(
                    ICON_BTN,
                    'hover:text-neutral-700 hover:bg-neutral-100 focus-visible:opacity-100',
                    hasFeedback ? 'text-neutral-500' : 'opacity-0 group-hover:opacity-100 max-md:opacity-100',
                  )}
                >
                  <ChatCircleText weight={hasFeedback ? 'fill' : 'duotone'} size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => removeOption(a.answer_id, false)}
                  className={cn(ICON_BTN, 'hover:text-red-500 hover:bg-neutral-100 opacity-0 group-hover:opacity-100 focus:opacity-100 max-md:opacity-100')}
                  title={t('editor.blocks.quiz_block.delete_answer')}
                  aria-label={t('editor.blocks_v2.quiz.delete_option', { letter, defaultValue: 'Delete option {{letter}}' })}
                >
                  <Trash weight="duotone" size={12} />
                </button>
              </div>
              {feedbackShown && (
                <div className={cn('flex items-start gap-1.5 pt-1', q.answers.length > 1 ? 'ps-[30px]' : 'ps-8')}>
                  <ChatCircleText weight="duotone" size={11} className="mt-[3px] shrink-0 text-neutral-400" />
                  <DraftText
                    ref={register(`f:${a.answer_id}`)}
                    value={a.feedback ?? ''}
                    maxLength={1000}
                    ariaLabel={t('editor.blocks_v2.quiz.feedback_toggle', { letter, defaultValue: 'Feedback for option {{letter}}' })}
                    placeholder={
                      a.correct
                        ? t('editor.blocks_v2.quiz.feedback_correct_placeholder', 'Why this is right (shown after submitting)')
                        : t('editor.blocks_v2.quiz.feedback_placeholder', 'Feedback when this option is picked')
                    }
                    onCommit={(v) =>
                      commit((qs) =>
                        updateQuestion(qs, qid, (x) => ({
                          ...x,
                          answers: x.answers.map((y) => (y.answer_id === a.answer_id ? withOptionalText(y, 'feedback', v) : y)),
                        })),
                      )
                    }
                    onFocusChange={(f) => {
                      if (!f && !a.feedback?.trim()) setOpenFeedback((s) => ({ ...s, [a.answer_id]: false }))
                    }}
                    className="text-[11px] leading-4 text-neutral-500 placeholder:text-neutral-300"
                  />
                </div>
              )}
            </div>
          )
        })}

        {q.answers.length < MAX_ANSWERS && (
          <button
            type="button"
            onClick={() => addOptionAfter(null)}
            className="w-full flex items-center justify-center gap-1 h-7 rounded-lg text-[11px] font-medium text-neutral-500 hover:text-neutral-700 border border-dashed border-neutral-200 hover:border-neutral-300 hover:bg-white transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
          >
            <Plus weight="duotone" size={11} />
            {t('editor.blocks.quiz_block.add_answer')}
          </button>
        )}
      </div>

      {explanationShown && (
        <div className="mt-1.5 flex items-start gap-2 rounded-lg bg-white nice-shadow px-2 py-1.5">
          <Lightbulb weight="duotone" size={13} className="mt-1 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold text-neutral-500">{t('editor.blocks_v2.quiz.explanation', 'Explanation')}</div>
            <DraftText
              ref={register(`e:${qid}`)}
              value={q.explanation ?? ''}
              maxLength={2000}
              ariaLabel={t('editor.blocks_v2.quiz.explanation', 'Explanation')}
              placeholder={t('editor.blocks_v2.quiz.explanation_placeholder', 'Shown to learners after they submit')}
              onCommit={(v) => commit((qs) => updateQuestion(qs, qid, (x) => withOptionalText(x, 'explanation', v)))}
              onFocusChange={(f) => {
                if (!f && !q.explanation?.trim()) setExplanationOpen(false)
              }}
              className="text-xs leading-5 text-neutral-600 placeholder:text-neutral-300"
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default QuizEditor
