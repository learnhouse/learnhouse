'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckSquare, DownloadSimple, FileText, LockSimple, Square } from '@phosphor-icons/react'
import { Button } from '@/design'
import { getLanguageById } from '@components/Objects/Editor/Extensions/CodePlayground/languages'
import { downloadPeerReviewFile, type PeerReviewTask } from '@services/courses/peerReview'
import { jsonToLines } from './peerReviewLogic'
import { useAccessToken, useErrorToast } from './usePeerReview'

// Read-only renderers for a classmate's answers. Correctness is never shown:
// the API strips answer keys and this view only echoes what was written.

function Empty() {
  const { t } = useTranslation()
  return <p className='text-sm italic text-neutral-400'>{t('peer_review.learner.no_answer')}</p>
}

function Prompt({ text }: { text?: string | null }) {
  if (!text || !String(text).trim()) return null
  return <p className='text-sm text-neutral-500 whitespace-pre-wrap break-words'>{text}</p>
}

function TextAnswer({ value, suffix }: { value: unknown; suffix?: string | null }) {
  const text = value === null || value === undefined ? '' : String(value)
  if (!text.trim()) return <Empty />
  return (
    <p className='rounded-xl bg-neutral-50 px-3.5 py-2.5 text-sm leading-relaxed text-neutral-800 whitespace-pre-wrap break-words'>
      {text}
      {suffix ? <span className='ms-1 text-neutral-500'>{suffix}</span> : null}
    </p>
  )
}

function FormAnswer({ contents, submission }: { contents: any; submission: any }) {
  const questions: any[] = Array.isArray(contents?.questions) ? contents.questions : []
  const answers: any[] = Array.isArray(submission?.submissions) ? submission.submissions : []
  if (questions.length === 0 && answers.length === 0) return <Empty />
  const find = (q: string | undefined, b: string | undefined) =>
    answers.find((a) => a?.questionUUID === q && a?.blankUUID === b)?.answer
  return (
    <dl className='flex flex-col gap-3'>
      {questions.map((q, qi) => (
        <div key={q?.questionUUID || qi} className='flex flex-col gap-1.5'>
          <dt className='text-sm font-medium text-neutral-700 break-words'>{q?.questionText}</dt>
          {(Array.isArray(q?.blanks) ? q.blanks : []).map((b: any, bi: number) => (
            <dd key={b?.blankUUID || bi} className='flex flex-col gap-0.5'>
              {b?.placeholder && <span className='text-xs text-neutral-400'>{b.placeholder}</span>}
              <TextAnswer value={find(q?.questionUUID, b?.blankUUID)} />
            </dd>
          ))}
        </div>
      ))}
    </dl>
  )
}

function QuizAnswer({ contents, submission }: { contents: any; submission: any }) {
  const { t } = useTranslation()
  const questions: any[] = Array.isArray(contents?.questions) ? contents.questions : []
  const picks: any[] = Array.isArray(submission?.submissions) ? submission.submissions : []
  if (questions.length === 0) return <Empty />
  const chosen = (q: string | undefined, o: string | undefined) =>
    picks.some((p) => p?.questionUUID === q && p?.optionUUID === o && p?.answer === true)
  return (
    <ol className='flex flex-col gap-4'>
      {questions.map((q, qi) => {
        const options: any[] = Array.isArray(q?.options) ? q.options : []
        const anyChosen = options.some((o) => chosen(q?.questionUUID, o?.optionUUID))
        return (
          <li key={q?.questionUUID || qi} className='flex flex-col gap-2'>
            <p className='text-sm font-medium text-neutral-700 break-words'>{q?.questionText}</p>
            <ul className='flex flex-col gap-1.5'>
              {options.map((o, oi) => {
                const on = chosen(q?.questionUUID, o?.optionUUID)
                return (
                  <li
                    key={o?.optionUUID || oi}
                    className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${on ? 'bg-sky-50 text-sky-900 font-medium' : 'text-neutral-500'}`}
                  >
                    {on ? (
                      <CheckSquare size={16} weight='fill' className='mt-0.5 shrink-0 text-sky-600' aria-hidden='true' />
                    ) : (
                      <Square size={16} className='mt-0.5 shrink-0 text-neutral-300' aria-hidden='true' />
                    )}
                    <span className='break-words'>
                      {o?.type && o.type !== 'text' && !o?.text ? t('peer_review.learner.media_option', { n: oi + 1 }) : o?.text}
                      {on && <span className='sr-only'> ({t('peer_review.learner.chosen')})</span>}
                    </span>
                  </li>
                )
              })}
            </ul>
            {!anyChosen && <Empty />}
          </li>
        )
      })}
    </ol>
  )
}

function CodeAnswer({ contents, submission }: { contents: any; submission: any }) {
  const code: string = submission?.source_code ?? ''
  const lang = getLanguageById(Number(contents?.language_id))
  if (!code.trim()) return <Empty />
  return (
    <div className='overflow-hidden rounded-xl bg-neutral-900 lh-keep-light'>
      {lang && (
        <div className='border-b border-white/10 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/50'>
          {lang.name}
        </div>
      )}
      {/* rtl-ok: code reads left to right in every UI language. */}
      <pre dir='ltr' className='max-h-[420px] overflow-auto p-3.5 text-[13px] leading-relaxed text-neutral-100'>
        <code>{code}</code>
      </pre>
    </div>
  )
}

function FileAnswer({ task, reviewUuid }: { task: PeerReviewTask; reviewUuid: string }) {
  const { t } = useTranslation()
  const accessToken = useAccessToken()
  const toastError = useErrorToast()
  const [loading, setLoading] = useState(false)
  const hasFile = !!(task.task_submission?.fileUUID || task.file_url)
  if (!hasFile) return <Empty />
  return (
    <Button
      size='sm'
      icon={<DownloadSimple size={14} />}
      loading={loading}
      onClick={async () => {
        if (!accessToken) return
        setLoading(true)
        try {
          await downloadPeerReviewFile(reviewUuid, task.assignment_task_uuid, accessToken, task.file_url)
        } catch (e) {
          toastError(e, 'peer_review.learner.error_download')
        } finally {
          setLoading(false)
        }
      }}
    >
      {t('peer_review.learner.download_file')}
    </Button>
  )
}

// Auto-graded tasks (quiz, number, keyed short answer, ...) are withheld by the
// API: a reviewer could otherwise copy a classmate's answers into a retry.
function HiddenAnswer() {
  const { t } = useTranslation()
  return (
    <p className='flex items-start gap-2 rounded-xl bg-neutral-50 px-3.5 py-2.5 text-sm text-neutral-500'>
      <LockSimple size={16} className='mt-0.5 shrink-0 text-neutral-400' aria-hidden='true' />
      <span>{t('peer_review.learner.answer_hidden')}</span>
    </p>
  )
}

function GenericAnswer({ submission }: { submission: any }) {
  const lines = jsonToLines(submission)
  if (lines.length === 0) return <Empty />
  return (
    <pre className='rounded-xl bg-neutral-50 px-3.5 py-2.5 text-sm leading-relaxed text-neutral-800 whitespace-pre-wrap break-words font-sans'>
      {lines.join('\n')}
    </pre>
  )
}

export function TaskAnswer({ task, reviewUuid }: { task: PeerReviewTask; reviewUuid: string }) {
  const type = String(task.assignment_type || (task as any).type || '').toUpperCase()
  const contents = task.contents ?? {}
  const sub = task.task_submission ?? null
  if (task.answer_hidden) return <HiddenAnswer />
  switch (type) {
    case 'SHORT_ANSWER':
      return (
        <div className='flex flex-col gap-2'>
          <Prompt text={contents?.prompt} />
          <TextAnswer value={sub?.answer} />
        </div>
      )
    case 'NUMBER_ANSWER':
      return (
        <div className='flex flex-col gap-2'>
          <Prompt text={contents?.prompt} />
          <TextAnswer value={sub?.answer} suffix={contents?.unit} />
        </div>
      )
    case 'FORM':
      return <FormAnswer contents={contents} submission={sub} />
    case 'QUIZ':
      return <QuizAnswer contents={contents} submission={sub} />
    case 'CODE':
      return <CodeAnswer contents={contents} submission={sub} />
    case 'FILE_SUBMISSION':
      return <FileAnswer task={task} reviewUuid={reviewUuid} />
    default:
      return <GenericAnswer submission={sub} />
  }
}

export default function SubmissionViewer({ tasks, reviewUuid }: { tasks: PeerReviewTask[]; reviewUuid: string }) {
  const { t } = useTranslation()
  // The API returns tasks in the instructor's order; `order` only refines it.
  const ordered = [...(tasks ?? [])].sort(
    (a, b) => (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY) || 0
  )
  if (ordered.length === 0) {
    return (
      <div className='flex items-center gap-2 rounded-xl bg-neutral-50 p-4 text-sm text-neutral-500'>
        <FileText size={16} aria-hidden='true' />
        {t('peer_review.learner.no_tasks')}
      </div>
    )
  }
  return (
    <ol className='flex flex-col gap-4'>
      {ordered.map((task, i) => {
        const title = task.title || task.description || ''
        return (
          <li key={task.assignment_task_uuid || i} className='flex flex-col gap-2.5 rounded-xl ring-1 ring-inset ring-neutral-100 p-3.5 sm:p-4'>
            <div className='flex items-start gap-2.5'>
              <span className='mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-neutral-100 text-[11px] font-bold text-neutral-600 tabular-nums'>
                {i + 1}
              </span>
              <div className='min-w-0'>
                <p className='text-sm font-semibold leading-snug text-neutral-900 break-words'>{title}</p>
                {task.description && task.description !== title && (
                  <p className='mt-0.5 text-sm text-neutral-500 whitespace-pre-wrap break-words'>{task.description}</p>
                )}
              </div>
            </div>
            <TaskAnswer task={task} reviewUuid={reviewUuid} />
          </li>
        )
      })}
    </ol>
  )
}
