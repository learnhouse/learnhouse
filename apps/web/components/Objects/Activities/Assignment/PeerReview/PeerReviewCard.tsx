'use client'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { CalendarBlank, Check, Lock, UsersThree } from '@phosphor-icons/react'
import { Chip } from '@/design'
import type { PeerReviewLearnerState } from '@services/courses/peerReview'
import CalibrationStep from './CalibrationStep'
import FeedbackStep from './FeedbackStep'
import ReviewsStep from './ReviewsStep'
import SelfReviewStep from './SelfReviewStep'
import { buildSteps, defaultStep, isPast, parseLocalDate, reviewProgress, type StepItem, type StepKey } from './peerReviewLogic'
import { useFormatDate, usePeerReviewMe } from './usePeerReview'

const REVIEWABLE = new Set(['SUBMITTED', 'GRADED', 'LATE'])

/**
 * Peer review inside the learner's assignment view. One GET /peer-review/me
 * decides everything: when peer review is off (or the endpoint is missing)
 * this renders nothing, so assignments without it look exactly as before.
 */
export default function PeerReviewCard({
  assignmentUuid,
  submissionStatus,
}: {
  assignmentUuid: string | undefined
  /** The learner's submission status from the assignment view, to refetch on hand-in. */
  submissionStatus: string | null | undefined
}) {
  const { data: state, isLoading, error, refetch } = usePeerReviewMe(assignmentUuid)

  // Handing in changes what /me returns (steps unlock); refresh when it flips.
  // Only on an actual change, so mounting costs exactly one request.
  const lastStatus = useRef(submissionStatus)
  useEffect(() => {
    if (lastStatus.current === submissionStatus) return
    lastStatus.current = submissionStatus
    if (assignmentUuid) void refetch()
  }, [submissionStatus, assignmentUuid, refetch])

  // Teachers previewing the activity manage peer review from the dashboard.
  if (!assignmentUuid || isLoading || error || !state || !state.enabled || state.is_instructor) return null

  const status = state.my_submission_status ?? submissionStatus ?? null
  if (!status || !REVIEWABLE.has(String(status).toUpperCase())) {
    return <PeerReviewUpNext state={state} />
  }
  return <PeerReviewStepper assignmentUuid={assignmentUuid} state={state} />
}

function Header({ state }: { state: PeerReviewLearnerState }) {
  const { t } = useTranslation()
  const formatDate = useFormatDate()
  const due = parseLocalDate(state.settings.review_due_date)
  const past = isPast(state.settings.review_due_date)
  return (
    <div className='flex flex-wrap items-start justify-between gap-3'>
      <div className='flex min-w-0 items-center gap-3'>
        <span className='flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-sky-50 text-sky-700'>
          <UsersThree size={19} aria-hidden='true' />
        </span>
        <div className='min-w-0'>
          <p className='text-[11px] font-semibold uppercase tracking-wider text-neutral-400'>{t('peer_review.learner.eyebrow')}</p>
          <h3 className='text-sm font-semibold text-neutral-900'>{t('peer_review.learner.card_title')}</h3>
        </div>
      </div>
      {due && (
        <Chip tone={past ? 'rose' : 'neutral'} icon={<CalendarBlank size={13} aria-hidden='true' />}>
          {past
            ? t('peer_review.learner.reviews_closed_on', { date: formatDate(due.at, due.hasTime) })
            : t('peer_review.learner.reviews_due', { date: formatDate(due.at, due.hasTime) })}
        </Chip>
      )}
    </div>
  )
}

/** Before hand-in: a quiet promise of what comes next. */
function PeerReviewUpNext({ state }: { state: PeerReviewLearnerState }) {
  const { t } = useTranslation()
  return (
    <div className='flex items-start gap-3 rounded-2xl bg-sky-50/60 p-4'>
      <UsersThree size={18} className='mt-0.5 shrink-0 text-sky-600' aria-hidden='true' />
      <div className='min-w-0'>
        <p className='text-sm font-semibold text-sky-900'>{t('peer_review.learner.next_title')}</p>
        <p className='text-sm text-sky-800/80'>
          {t('peer_review.learner.next_body', { count: state.settings.reviews_required || state.steps.reviews.required })}
        </p>
      </div>
    </div>
  )
}

function stepLabel(t: TFunction, key: StepKey) {
  switch (key) {
    case 'self':
      return t('peer_review.learner.step_self')
    case 'calibration':
      return t('peer_review.learner.step_practice')
    case 'reviews':
      return t('peer_review.learner.step_reviews')
    default:
      return t('peer_review.learner.step_feedback')
  }
}

function stepDetail(t: TFunction, item: StepItem, state: PeerReviewLearnerState) {
  if (item.key === 'calibration') return t('peer_review.learner.n_of_m', { n: state.steps.calibration.done, m: state.steps.calibration.total })
  if (item.key === 'reviews') {
    const p = reviewProgress(state.steps.reviews)
    return t('peer_review.learner.n_of_m', { n: p.done, m: p.required })
  }
  if (item.key === 'feedback') {
    return state.steps.feedback.unlocked
      ? t('peer_review.learner.feedback_count', { count: state.steps.feedback.count })
      : t('peer_review.learner.locked')
  }
  return item.status === 'done' ? t('peer_review.learner.done') : t('peer_review.learner.to_do')
}

function PeerReviewStepper({ assignmentUuid, state }: { assignmentUuid: string; state: PeerReviewLearnerState }) {
  const { t } = useTranslation()
  const items = useMemo(() => buildSteps(state.steps), [state.steps])
  const [active, setActive] = useState<StepKey>(() => defaultStep(items, !!state.steps.reviews.open_review_uuid))
  const current = items.some((i) => i.key === active) ? active : items[0]?.key ?? 'reviews'
  const calibrationPending = items.some((i) => i.key === 'calibration' && i.status === 'todo')
  const go = (key: StepKey) => {
    setActive(key)
    requestAnimationFrame(() => document.getElementById('peer-review-step')?.focus({ preventScroll: false }))
  }

  return (
    <section aria-labelledby='peer-review-card-title' className='rounded-2xl bg-white nice-shadow'>
      <div className='flex flex-col gap-4 p-4 sm:p-5'>
        <span id='peer-review-card-title' className='sr-only'>{t('peer_review.learner.card_title')}</span>
        <Header state={state} />

        <nav aria-label={t('peer_review.learner.steps_label')} className='-mx-1 overflow-x-auto scrollbar-hide'>
          <ol className='flex min-w-max gap-1.5 px-1 sm:min-w-0'>
            {items.map((item, i) => {
              const isActive = item.key === current
              return (
                <li key={item.key} className='flex-1'>
                  <button
                    type='button'
                    onClick={() => go(item.key)}
                    aria-current={isActive ? 'step' : undefined}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20 ${
                      isActive ? 'bg-neutral-900 text-white' : 'bg-neutral-50 text-neutral-700 hover:bg-neutral-100'
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-[11px] font-bold tabular-nums ${
                        item.status === 'done'
                          ? 'bg-emerald-500 text-white'
                          : item.status === 'locked'
                            ? isActive ? 'bg-white/15 text-white/70' : 'bg-neutral-200 text-neutral-500'
                            : isActive ? 'bg-white text-neutral-900' : 'bg-white text-neutral-700 ring-1 ring-neutral-200'
                      }`}
                      aria-hidden='true'
                    >
                      {item.status === 'done' ? <Check size={12} weight='bold' /> : item.status === 'locked' ? <Lock size={11} weight='bold' /> : i + 1}
                    </span>
                    <span className='min-w-0'>
                      <span className='block text-sm font-semibold leading-tight whitespace-nowrap'>{stepLabel(t, item.key)}</span>
                      <span className={`block text-xs tabular-nums whitespace-nowrap ${isActive ? 'text-white/70' : 'text-neutral-500'}`}>
                        {stepDetail(t, item, state)}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        </nav>

        <div id='peer-review-step' tabIndex={-1} className='border-t border-neutral-100 pt-5 focus:outline-none'>
          {current === 'self' && (
            <SelfReviewStep assignmentUuid={assignmentUuid} state={state} onFinished={() => go(nextAfter(items, 'self'))} />
          )}
          {current === 'calibration' && (
            <CalibrationStep assignmentUuid={assignmentUuid} state={state} onFinished={() => go('reviews')} />
          )}
          {current === 'reviews' && (
            <ReviewsStep
              assignmentUuid={assignmentUuid}
              state={state}
              calibrationPending={calibrationPending}
              onGoToCalibration={() => go('calibration')}
              onGoToFeedback={() => go('feedback')}
            />
          )}
          {current === 'feedback' && <FeedbackStep assignmentUuid={assignmentUuid} state={state} onGoToReviews={() => go('reviews')} />}
        </div>
      </div>
    </section>
  )
}

function nextAfter(items: StepItem[], key: StepKey): StepKey {
  const i = items.findIndex((x) => x.key === key)
  return items[i + 1]?.key ?? 'feedback'
}
