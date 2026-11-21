'use client'
/*
 Authoring controls for the question kinds added next to multiple choice:
 the kind picker, the true/false key, accepted short answers and the numeric
 key. Same look as the rest of the quiz editor (small neutral chips, white
 rows with the soft shadow). Every write goes through the editor's `commit`,
 so it builds on the latest stored questions.
*/
import React from 'react'
import { Check, ListBullets, NumberSquareOne, Plus, TextAa, ToggleLeft, Trash, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { DraftText } from '../../Blocks/ui/DraftText'
import {
  MAX_ACCEPTED_ANSWERS,
  QUESTION_TYPES,
  questionKind,
  setAccentInsensitive,
  setAcceptedAnswers,
  setNumericAnswer,
  setQuestionType,
  setTrueFalseAnswer,
  trueFalseValue,
  type EditableQuestionType,
  type QuizQuestion,
} from './quizModel'

type Commit = (_fn: (_qs: QuizQuestion[]) => QuizQuestion[]) => void

const CHIP =
  'inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40'
const ICON_BTN =
  'shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-neutral-400 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40'

const TYPE_ICON: Record<EditableQuestionType, React.ReactNode> = {
  multiple_choice: <ListBullets size={10} weight="bold" />,
  true_false: <ToggleLeft size={10} weight="bold" />,
  short_answer: <TextAa size={10} weight="bold" />,
  numeric: <NumberSquareOne size={10} weight="bold" />,
}

export function useQuestionTypeLabels() {
  const { t } = useTranslation()
  return React.useMemo(
    () => ({
      multiple_choice: t('editor.blocks_v2.quiz.type_multiple_choice', 'Multiple choice'),
      true_false: t('editor.blocks_v2.quiz.type_true_false', 'True / false'),
      short_answer: t('editor.blocks_v2.quiz.type_short_answer', 'Short answer'),
      numeric: t('editor.blocks_v2.quiz.type_numeric', 'Number'),
    }),
    [t],
  )
}

export function trueFalseLabels(t: (_k: string, _d: string) => string) {
  return { true: t('editor.blocks_v2.quiz.true', 'True'), false: t('editor.blocks_v2.quiz.false', 'False') }
}

/** The kind picker shown above each question's answers. */
export function QuestionTypePicker({ question, commit }: { question: QuizQuestion; commit: Commit }) {
  const { t } = useTranslation()
  const labels = useQuestionTypeLabels()
  const kind = questionKind(question)
  return (
    <div role="radiogroup" aria-label={t('editor.blocks_v2.quiz.question_type', 'Question type')} className="flex flex-wrap items-center gap-1">
      {QUESTION_TYPES.map((type) => (
        <button
          key={type}
          type="button"
          role="radio"
          aria-checked={kind === type}
          onClick={() => kind !== type && commit((qs) => setQuestionType(qs, question.question_id, type, trueFalseLabels(t)))}
          className={cn(CHIP, kind === type ? 'bg-neutral-800 text-white' : 'bg-white text-neutral-600 nice-shadow hover:bg-neutral-100')}
        >
          {TYPE_ICON[type]}
          {labels[type]}
        </button>
      ))}
    </div>
  )
}

/** True / false: one click picks which statement is right. */
export function TrueFalseEditor({ question, commit }: { question: QuizQuestion; commit: Commit }) {
  const { t } = useTranslation()
  const value = trueFalseValue(question)
  const labels = trueFalseLabels(t)
  return (
    <div role="radiogroup" aria-label={t('editor.blocks_v2.quiz.correct_answer', 'Correct answer')} className="grid grid-cols-2 gap-1.5">
      {([true, false] as const).map((v) => {
        const active = value === v
        return (
          <button
            key={String(v)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => commit((qs) => setTrueFalseAnswer(qs, question.question_id, v))}
            className={cn(
              'flex items-center gap-2 rounded-lg nice-shadow px-2 py-1.5 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40',
              active ? 'bg-emerald-50 text-emerald-900 font-medium' : 'bg-white text-neutral-700 hover:bg-neutral-50',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'shrink-0 w-6 h-6 flex items-center justify-center rounded-full',
                active ? 'bg-emerald-500 text-white' : 'bg-neutral-100 text-neutral-500',
              )}
            >
              {v ? <Check size={12} weight="bold" /> : <X size={12} weight="bold" />}
            </span>
            {v ? labels.true : labels.false}
          </button>
        )
      })}
    </div>
  )
}

/** Short answer: the answers that count as right, plus the accent option. */
export function ShortAnswerEditor({ question, commit }: { question: QuizQuestion; commit: Commit }) {
  const { t } = useTranslation()
  const qid = question.question_id
  const stored = question.accepted_answers ?? []
  // Always show at least one field to type into.
  const rows = stored.length ? stored : ['']
  const write = (next: string[]) => commit((qs) => setAcceptedAnswers(qs, qid, next))
  const accentId = React.useId()
  return (
    <div className="space-y-1">
      <div className="px-1 text-[10px] font-medium text-neutral-500">{t('editor.blocks_v2.quiz.accepted_answers', 'Accepted answers')}</div>
      <div role="list" className="space-y-1">
        {rows.map((value, i) => (
          <div key={i} role="listitem" className="group flex items-center gap-2 rounded-lg nice-shadow bg-white px-2 py-1.5">
            <Check size={12} weight="bold" className="shrink-0 text-emerald-500" aria-hidden />
            <div className="min-w-0 flex-1">
              <DraftText
                value={value}
                multiline={false}
                maxLength={500}
                ariaLabel={t('editor.blocks_v2.quiz.accepted_answer_n', { n: i + 1, defaultValue: 'Accepted answer {{n}}' })}
                placeholder={t('editor.blocks_v2.quiz.accepted_answer_placeholder', 'An answer that counts as right')}
                onCommit={(v) => {
                  const next = [...rows]
                  next[i] = v
                  write(next)
                }}
                onEnter={() => rows.length < MAX_ACCEPTED_ANSWERS && write([...rows, ''])}
                className="text-sm leading-6 text-neutral-700"
              />
            </div>
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => write(rows.filter((_, j) => j !== i))}
                aria-label={t('editor.blocks_v2.quiz.remove_accepted', { n: i + 1, defaultValue: 'Remove accepted answer {{n}}' })}
                title={t('editor.blocks_v2.quiz.remove_accepted', { n: i + 1, defaultValue: 'Remove accepted answer {{n}}' })}
                className={cn(ICON_BTN, 'hover:text-red-500 hover:bg-neutral-100 opacity-0 group-hover:opacity-100 focus:opacity-100 max-md:opacity-100')}
              >
                <Trash weight="duotone" size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-0.5">
        {rows.length < MAX_ACCEPTED_ANSWERS ? (
          <button
            type="button"
            onClick={() => write([...rows, ''])}
            className={cn(CHIP, 'bg-neutral-200 text-neutral-600 hover:bg-neutral-300')}
          >
            <Plus size={10} weight="bold" />
            {t('editor.blocks_v2.quiz.add_accepted', 'Another accepted answer')}
          </button>
        ) : (
          <span />
        )}
        <label htmlFor={accentId} className="flex items-center gap-1.5 text-[11px] text-neutral-500">
          <input
            id={accentId}
            type="checkbox"
            className="h-3.5 w-3.5 accent-neutral-900"
            checked={question.accent_insensitive === true}
            onChange={(e) => commit((qs) => setAccentInsensitive(qs, qid, e.target.checked))}
          />
          {t('editor.blocks_v2.quiz.ignore_accents', 'Ignore accents (é = e)')}
        </label>
      </div>
      <p className="px-1 text-[10px] leading-snug text-neutral-400">
        {t('editor.blocks_v2.quiz.short_answer_hint', 'Capital letters and extra spaces are ignored.')}
      </p>
    </div>
  )
}

function NumberField({ value, onCommit, label, placeholder }: { value: number | undefined; onCommit: (_v: string) => void; label: string; placeholder: string }) {
  const shown = value === undefined ? '' : String(value)
  const [draft, setDraft] = React.useState(shown)
  const editing = React.useRef(false)
  React.useEffect(() => {
    if (!editing.current) setDraft(shown)
  }, [shown])
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="px-1 text-[10px] font-medium text-neutral-500">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        placeholder={placeholder}
        onFocus={() => (editing.current = true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          editing.current = false
          if (draft !== shown) onCommit(draft)
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setDraft(shown)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        className="h-8 w-full rounded-lg bg-white nice-shadow px-2 text-sm text-neutral-800 outline-none placeholder:text-neutral-300 focus-visible:ring-2 focus-visible:ring-sky-500/40"
      />
    </label>
  )
}

/** Numeric: the expected value and how far off still counts. */
export function NumericEditor({ question, commit }: { question: QuizQuestion; commit: Commit }) {
  const { t } = useTranslation()
  const qid = question.question_id
  return (
    <div className="flex flex-wrap items-end gap-2">
      <NumberField
        value={question.correct_value}
        label={t('editor.blocks_v2.quiz.numeric_value', 'Correct answer')}
        placeholder="42"
        onCommit={(v) => commit((qs) => setNumericAnswer(qs, qid, { correct_value: v }))}
      />
      <span aria-hidden className="pb-2 text-sm text-neutral-400">±</span>
      <NumberField
        value={question.tolerance ?? 0}
        label={t('editor.blocks_v2.quiz.numeric_tolerance', 'Tolerance')}
        placeholder="0"
        onCommit={(v) => commit((qs) => setNumericAnswer(qs, qid, { tolerance: v }))}
      />
    </div>
  )
}
