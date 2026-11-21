'use client'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowRight, CheckCircle, Lightbulb, Target } from '@phosphor-icons/react'
import { Button, Chip, Skeleton, StatusPill } from '@/design'
import { queryKeys } from '@/lib/query/keys'
import {
  getCalibrationSamples,
  submitCalibration,
  type CalibrationResult,
  type PeerReviewCriterion,
  type PeerReviewLearnerState,
} from '@services/courses/peerReview'
import { RubricForm } from './RubricForm'
import { ProgressBar, StepIntro } from './shared'
import { levelPoints, validateReview } from './peerReviewLogic'
import { useAccessToken, useErrorToast, useInvalidatePeerReview } from './usePeerReview'

function levelLabel(criterion: PeerReviewCriterion | undefined, levelId: string | null | undefined) {
  if (!criterion || !levelId) return null
  return criterion.levels.find((l) => l.id === levelId)?.label ?? null
}

/** "You vs instructor", one row per criterion, then the instructor's reasoning. */
export function CalibrationComparison({ rubric, result }: { rubric: PeerReviewCriterion[]; result: CalibrationResult }) {
  const { t } = useTranslation()
  const byId = useMemo(() => new Map(rubric.map((c) => [c.id, c])), [rubric])
  return (
    <div className='flex flex-col gap-3'>
      <ul className='flex flex-col divide-y divide-neutral-100 rounded-xl ring-1 ring-inset ring-neutral-100'>
        {result.criteria.map((row) => {
          const c = byId.get(row.criterion_id)
          const yours = row.your_points ?? (c ? levelPoints(c, row.your_level_id) : null)
          const theirs = row.instructor_points ?? (c ? levelPoints(c, row.instructor_level_id) : null)
          const diff = yours !== null && theirs !== null ? Math.abs(yours - theirs) : null
          const match = row.match ?? (!!row.your_level_id && row.your_level_id === row.instructor_level_id)
          return (
            <li key={row.criterion_id} className='flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between'>
              <p className='min-w-0 text-sm font-medium text-neutral-800 break-words'>{c?.title ?? row.title ?? row.criterion_id}</p>
              <div className='flex flex-wrap items-center gap-1.5'>
                <Chip tone='sky'>
                  {t('peer_review.learner.cal_you')}: {levelLabel(c, row.your_level_id) ?? '—'}
                </Chip>
                <Chip tone='neutral'>
                  {t('peer_review.learner.cal_instructor')}: {levelLabel(c, row.instructor_level_id) ?? '—'}
                </Chip>
                {match ? (
                  <StatusPill status='success' icon={<CheckCircle size={13} weight='fill' />}>
                    {t('peer_review.learner.cal_match')}
                  </StatusPill>
                ) : diff !== null ? (
                  <StatusPill status='warning'>{t('peer_review.learner.cal_off_by', { count: diff })}</StatusPill>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
      {result.explanation && (
        <div className='flex items-start gap-2.5 rounded-xl bg-amber-50/70 p-3.5'>
          <Lightbulb size={16} className='mt-0.5 shrink-0 text-amber-600' aria-hidden='true' />
          <div className='min-w-0'>
            <p className='text-xs font-semibold uppercase tracking-wide text-amber-800'>{t('peer_review.learner.cal_why_title')}</p>
            <p className='mt-0.5 text-sm leading-relaxed text-amber-900/90 whitespace-pre-wrap break-words'>{result.explanation}</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default function CalibrationStep({
  assignmentUuid,
  state,
  onFinished,
}: {
  assignmentUuid: string
  state: PeerReviewLearnerState
  onFinished: () => void
}) {
  const { t } = useTranslation()
  const accessToken = useAccessToken()
  const invalidate = useInvalidatePeerReview(assignmentUuid)
  const toastError = useErrorToast()
  const rubric = state.settings.rubric ?? []
  const { total, done } = state.steps.calibration

  const samplesQuery = useQuery({
    queryKey: queryKeys.peerReview.calibration(assignmentUuid),
    queryFn: () => getCalibrationSamples(assignmentUuid, accessToken as string),
    enabled: !!accessToken,
    staleTime: 60_000,
  })
  const samples = samplesQuery.data ?? []

  const [scores, setScores] = useState<Record<string, string>>({})
  const [showErrors, setShowErrors] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ sampleId: string; data: CalibrationResult } | null>(null)

  const current = result ? samples.find((s) => s.id === result.sampleId) : samples.find((s) => !s.done)
  const allDone = total > 0 && done >= total && !result
  const position = Math.min(total, done + (result ? 0 : 1))

  const check = async () => {
    if (!current || !accessToken) return
    const v = validateReview(rubric, [], scores, {})
    if (!v.ok) {
      setShowErrors(true)
      toast.error(t('peer_review.learner.fix_before_submit'))
      return
    }
    setSaving(true)
    try {
      const data = await submitCalibration(assignmentUuid, current.id, scores, accessToken)
      setResult({ sampleId: current.id, data })
      setShowErrors(false)
      invalidate()
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  const next = () => {
    setResult(null)
    setScores({})
    if (done >= total) onFinished()
  }

  return (
    <div className='flex flex-col gap-5'>
      <StepIntro
        title={t('peer_review.learner.cal_title')}
        why={t('peer_review.learner.cal_why')}
        aside={
          total > 0 ? (
            <Chip tone='teal' icon={<Target size={13} />}>
              {allDone ? t('peer_review.learner.done') : t('peer_review.learner.cal_progress', { current: position, total })}
            </Chip>
          ) : null
        }
      />
      <ProgressBar pct={total > 0 ? (done / total) * 100 : 0} label={t('peer_review.learner.cal_title')} />

      {samplesQuery.isLoading ? (
        <div className='flex flex-col gap-3'>
          <Skeleton className='h-24 w-full' />
          <Skeleton className='h-16 w-full' />
        </div>
      ) : allDone ? (
        <div className='flex flex-col items-start gap-3 rounded-xl bg-emerald-50/70 p-4'>
          <p className='flex items-center gap-2 text-sm font-semibold text-emerald-800'>
            <CheckCircle size={16} weight='fill' aria-hidden='true' />
            {t('peer_review.learner.cal_all_done')}
          </p>
          <Button variant='primary' size='sm' icon={<ArrowRight size={14} className='rtl:rotate-180' />} onClick={onFinished}>
            {t('peer_review.learner.go_to_reviews')}
          </Button>
        </div>
      ) : current ? (
        <div className='flex flex-col gap-5'>
          <article className='flex flex-col gap-2 rounded-xl bg-neutral-50 p-4'>
            <p className='text-[11px] font-semibold uppercase tracking-wide text-neutral-400'>{t('peer_review.learner.cal_sample')}</p>
            <p className='text-sm font-semibold text-neutral-900 break-words'>{current.title}</p>
            <div className='prose prose-sm max-w-none break-words text-neutral-800' data-lh-user-content>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{current.content || ''}</ReactMarkdown>
            </div>
          </article>

          {result ? (
            <>
              <CalibrationComparison rubric={rubric} result={result.data} />
              <div className='flex justify-end border-t border-neutral-100 pt-4'>
                <Button variant='primary' icon={<ArrowRight size={14} className='rtl:rotate-180' />} onClick={next}>
                  {done >= total ? t('peer_review.learner.go_to_reviews') : t('peer_review.learner.cal_next')}
                </Button>
              </div>
            </>
          ) : (
            <>
              <RubricForm
                rubric={rubric}
                scores={scores}
                onScore={(c, l) => setScores((s) => ({ ...s, [c]: l }))}
                showErrors={showErrors}
                disabled={saving}
              />
              <div className='flex justify-end border-t border-neutral-100 pt-4'>
                <Button variant='primary' loading={saving} onClick={check}>
                  {t('peer_review.learner.cal_check')}
                </Button>
              </div>
            </>
          )}
        </div>
      ) : (
        <p className='text-sm text-neutral-500'>{t('peer_review.learner.cal_none')}</p>
      )}
    </div>
  )
}
