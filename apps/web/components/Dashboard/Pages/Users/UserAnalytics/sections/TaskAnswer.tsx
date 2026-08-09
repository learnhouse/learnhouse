'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, X, FileText, Code2 } from 'lucide-react'
import { P } from './primitives'

/**
 * Renders one task submission as questions, answers and verdicts.
 *
 * The server (services/audit/answers.py) has already joined the learner's stored
 * answer against the task's question bank, so every task type arrives in the same
 * shape and this component only has to lay it out. It deliberately mirrors the
 * teacher-facing TaskQuizObject — same lettered option tiles, same three-state
 * verdict badges — so a quiz reads identically in the dossier and in the grading
 * modal.
 *
 * `correct` is tri-state: `null` means the answer key was absent or the grader itself
 * skips the question, and must render as *no verdict* rather than as a failure.
 */

function Verdict({ correct }: { correct: boolean | null }) {
  const { t } = useTranslation()
  if (correct === null || correct === undefined) return null
  return correct ? (
    <span className="flex-none flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-700">
      <Check size={10} /> {t(`${P}.answer.correct`, { defaultValue: 'Correct' })}
    </span>
  ) : (
    <span className="flex-none flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg bg-rose-50 text-rose-600">
      <X size={10} /> {t(`${P}.answer.incorrect`, { defaultValue: 'Wrong' })}
    </span>
  )
}

function QuestionHeader({ item }: { item: any }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <p className="font-semibold text-gray-800 text-xs">
        {item.index}. {item.prompt}
      </p>
      <Verdict correct={item.correct} />
    </div>
  )
}

function QuizItem({ item }: { item: any }) {
  const { t } = useTranslation()
  // No key configured means no option can carry a verdict — labelling them anyway
  // would mark a fully correct submission as wrong.
  const keyPresent = item.expected_text !== null && item.expected_text !== undefined

  return (
    <div className="space-y-1.5">
      <QuestionHeader item={item} />
      <div className="flex flex-col gap-1">
        {(item.options || []).map((option: any, i: number) => (
          <div
            key={i}
            className={`flex items-center gap-2 rounded-lg pe-2 nice-shadow bg-white ${option.selected ? 'ring-1 ring-blue-200' : ''}`}
          >
            <div className="font-bold flex items-center h-[28px] w-[32px] rounded-s-md text-slate-800 bg-slate-100/80">
              <p className="mx-auto text-xs">{option.letter}</p>
            </div>
            <p className="flex-1 py-1 text-xs text-neutral-600 font-medium break-words">
              {option.text}
            </p>
            {keyPresent && option.selected && option.is_correct && (
              <span className="flex-none flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-700">
                <Check size={10} /> {t(`${P}.answer.correct`, { defaultValue: 'Correct' })}
              </span>
            )}
            {keyPresent && option.selected && !option.is_correct && (
              <span className="flex-none flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg bg-rose-50 text-rose-600">
                <X size={10} /> {t(`${P}.answer.incorrect`, { defaultValue: 'Wrong' })}
              </span>
            )}
            {/* Correct but not chosen. Options that were neither chosen nor correct
                get no badge — labelling every option reads as "all of these wrong". */}
            {keyPresent && !option.selected && option.is_correct && (
              <span className="flex-none flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg bg-emerald-50/70 text-emerald-700 border border-emerald-200">
                <Check size={10} /> {t(`${P}.answer.correct_answer`, { defaultValue: 'Correct answer' })}
              </span>
            )}
          </div>
        ))}
      </div>
      {!item.answer_text && (
        <p className="text-[11px] text-gray-400 italic">
          {t(`${P}.answer.no_answer`, { defaultValue: 'No answer given' })}
        </p>
      )}
    </div>
  )
}

function WrittenItem({ item }: { item: any }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-1.5">
      <QuestionHeader item={item} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="bg-gray-50 rounded-lg p-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            {t(`${P}.answer.answered`, { defaultValue: 'Answered' })}
          </div>
          <div className="text-xs text-gray-700 break-words">
            {item.answer_text || (
              <span className="text-gray-400 italic">
                {t(`${P}.answer.no_answer`, { defaultValue: 'No answer given' })}
              </span>
            )}
          </div>
        </div>
        {item.expected_text && (
          <div className="bg-emerald-50/60 rounded-lg p-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
              {t(`${P}.answer.expected`, { defaultValue: 'Expected answer' })}
            </div>
            <div className="text-xs text-emerald-800 break-words">{item.expected_text}</div>
          </div>
        )}
      </div>
    </div>
  )
}

function CodeAnswer({ code }: { code: any }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-slate-100 text-slate-600">
          <Code2 size={10} /> {code.language || '—'}
        </span>
        <span className="text-[11px] text-gray-500">
          {code.passed_tests}/{code.total_tests} {t(`${P}.answer.test_passed`, { defaultValue: 'Passed' })}
        </span>
      </div>
      {code.source_code && (
        <details className="text-[11px]">
          <summary className="cursor-pointer text-gray-500 font-semibold">
            {t(`${P}.answer.source_code`, { defaultValue: 'Submitted code' })}
          </summary>
          <pre className="mt-1 p-2 bg-gray-50 rounded-lg overflow-auto max-h-60 text-[11px] text-gray-700">
            {code.source_code}
          </pre>
        </details>
      )}
      {(code.test_results || []).length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            {t(`${P}.answer.test_cases`, { defaultValue: 'Test cases' })}
          </div>
          {code.test_results.map((tr: any, i: number) => (
            <div
              key={i}
              className={`flex items-center gap-2 text-[11px] rounded p-1.5 ${tr.hidden ? 'bg-gray-50 text-gray-400' : 'bg-white nice-shadow'}`}
            >
              <span className="font-semibold flex-none">{tr.name}</span>
              <Verdict correct={tr.passed} />
              {!tr.hidden && tr.expected && (
                <span className="truncate text-gray-500">
                  {t(`${P}.answer.expected`, { defaultValue: 'Expected answer' })}: {tr.expected}
                </span>
              )}
              {!tr.hidden && tr.actual && (
                <span className="truncate text-gray-500">
                  {t(`${P}.answer.actual`, { defaultValue: 'Output' })}: {tr.actual}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function TaskAnswer({ answer }: { answer: any }) {
  const { t } = useTranslation()
  if (!answer) return null

  const items = answer.items || []

  return (
    <div className="mt-2 space-y-3">
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        {answer.summary && <span className="text-gray-500">{answer.summary}</span>}
        {answer.total_count != null && (
          <span className="font-semibold text-gray-600">
            {t(`${P}.answer.score`, {
              correct: answer.correct_count ?? 0,
              total: answer.total_count,
              defaultValue: '{{correct}}/{{total}} correct',
            })}
          </span>
        )}
      </div>

      {answer.kind === 'code' && answer.code && <CodeAnswer code={answer.code} />}

      {answer.kind === 'file' &&
        items.map((item: any, i: number) => (
          <div key={i} className="flex items-center gap-2 text-xs text-gray-700">
            <FileText size={14} className="text-gray-400 flex-none" />
            <span className="break-words">{item.answer_text || '—'}</span>
          </div>
        ))}

      {answer.kind === 'quiz' &&
        items.map((item: any, i: number) => <QuizItem key={i} item={item} />)}

      {['form', 'short_answer', 'number_answer'].includes(answer.kind) &&
        items.map((item: any, i: number) => <WrittenItem key={i} item={item} />)}

      {answer.kind === 'raw' && (
        <div className="space-y-1">
          <p className="text-[11px] text-gray-400 italic">
            {t(`${P}.answer.raw_note`, { defaultValue: 'Custom task — shown as raw fields' })}
          </p>
          <dl className="text-[11px] space-y-0.5">
            {items.map((item: any, i: number) => (
              <div key={i} className="flex gap-2">
                <dt className="font-semibold text-gray-500 flex-none">{item.prompt}</dt>
                <dd className="text-gray-700 break-words">{item.answer_text}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {answer.explanation && (
        <div className="text-[11px] text-gray-600 bg-gray-50 rounded-lg p-2">
          <span className="font-semibold">
            {t(`${P}.answer.explanation`, { defaultValue: 'Explanation' })}:{' '}
          </span>
          {answer.explanation}
        </div>
      )}
    </div>
  )
}
