'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, CheckCircle, Hourglass, Lock, Plus, UsersThree } from '@phosphor-icons/react'
import { Button, Chip, EmptyState } from '@/design'
import { isPeerReviewRetrying, requestNextPeerReview, type PeerReviewLearnerState } from '@services/courses/peerReview'
import ReviewScreen from './ReviewScreen'
import { ProgressBar, StepIntro } from './shared'
import { reviewProgress } from './peerReviewLogic'
import { useAccessToken, useErrorToast, useInvalidatePeerReview, usePrompts } from './usePeerReview'

export default function ReviewsStep({
  assignmentUuid,
  state,
  calibrationPending,
  onGoToCalibration,
  onGoToFeedback,
}: {
  assignmentUuid: string
  state: PeerReviewLearnerState
  calibrationPending: boolean
  onGoToCalibration: () => void
  onGoToFeedback: () => void
}) {
  const { t } = useTranslation()
  const accessToken = useAccessToken()
  const toastError = useErrorToast()
  const invalidate = useInvalidatePeerReview(assignmentUuid)
  const prompts = usePrompts(state.settings.prompts)
  const step = state.steps.reviews
  const progress = reviewProgress(step)

  const [activeReview, setActiveReview] = useState<string | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [noneAvailable, setNoneAvailable] = useState(false)

  const openOrNext = async () => {
    if (step.open_review_uuid) {
      setActiveReview(step.open_review_uuid)
      return
    }
    if (!accessToken) return
    setRequesting(true)
    try {
      const res = await requestNextPeerReview(assignmentUuid, accessToken)
      if (res?.review?.review_uuid) {
        setNoneAvailable(false)
        setActiveReview(res.review.review_uuid)
        invalidate()
      } else {
        setNoneAvailable(true)
      }
    } catch (e: any) {
      if (isPeerReviewRetrying(e)) {
        toastError(new Error(t('peer_review.learner.retry_in_progress')))
      } else if (e?.status === 409) {
        toastError(e, 'peer_review.learner.finish_practice_first')
        onGoToCalibration()
      } else {
        toastError(e)
      }
    } finally {
      setRequesting(false)
    }
  }

  if (activeReview) {
    return (
      <ReviewScreen
        key={activeReview}
        assignmentUuid={assignmentUuid}
        reviewUuid={activeReview}
        rubric={state.settings.rubric ?? []}
        prompts={prompts}
        anonymity={state.settings.anonymity}
        progress={progress}
        onBack={() => {
          setActiveReview(null)
          invalidate()
        }}
        onSubmitted={() => setActiveReview(null)}
      />
    )
  }

  const intro = (
    <StepIntro
      title={t('peer_review.learner.reviews_title')}
      why={t('peer_review.learner.reviews_why')}
      aside={
        <Chip tone={progress.complete ? 'emerald' : 'teal'} icon={<UsersThree size={13} />}>
          {t('peer_review.learner.reviews_done_of', { done: progress.done, required: progress.required })}
        </Chip>
      }
    />
  )

  if (calibrationPending) {
    return (
      <div className='flex flex-col gap-5'>
        {intro}
        <div className='flex flex-col items-start gap-3 rounded-xl bg-neutral-50 p-4'>
          <p className='flex items-center gap-2 text-sm font-medium text-neutral-700'>
            <Lock size={16} className='text-neutral-400' aria-hidden='true' />
            {t('peer_review.learner.reviews_locked_practice')}
          </p>
          <Button size='sm' variant='primary' icon={<ArrowRight size={14} className='rtl:rotate-180' />} onClick={onGoToCalibration}>
            {t('peer_review.learner.go_to_practice')}
          </Button>
        </div>
      </div>
    )
  }

  const nothingToReview = !step.open_review_uuid && (noneAvailable || step.available === false)

  return (
    <div className='flex flex-col gap-5'>
      {intro}
      <ProgressBar
        pct={progress.pct}
        tone={progress.complete ? 'emerald' : 'teal'}
        label={t('peer_review.learner.reviews_done_of', { done: progress.done, required: progress.required })}
      />

      {progress.complete && (
        <div className='flex items-start gap-2.5 rounded-xl bg-emerald-50/70 p-3.5'>
          <CheckCircle size={16} weight='fill' className='mt-0.5 shrink-0 text-emerald-600' aria-hidden='true' />
          <div className='min-w-0'>
            <p className='text-sm font-semibold text-emerald-800'>{t('peer_review.learner.reviews_complete')}</p>
            <p className='text-sm text-emerald-700/90'>{t('peer_review.learner.reviews_extra_hint')}</p>
          </div>
        </div>
      )}

      {nothingToReview ? (
        <div className='rounded-xl bg-neutral-50'>
          <EmptyState
            icon={<Hourglass size={22} />}
            title={t('peer_review.learner.none_title')}
            description={t('peer_review.learner.none_body')}
            action={
              <Button size='sm' loading={requesting} onClick={openOrNext}>
                {t('peer_review.learner.check_again')}
              </Button>
            }
          />
        </div>
      ) : (
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            variant={progress.complete && !step.open_review_uuid ? 'secondary' : 'primary'}
            icon={step.open_review_uuid ? <ArrowRight size={14} className='rtl:rotate-180' /> : progress.complete ? <Plus size={14} /> : <ArrowRight size={14} className='rtl:rotate-180' />}
            loading={requesting}
            onClick={openOrNext}
          >
            {step.open_review_uuid
              ? t('peer_review.learner.continue_review')
              : progress.complete
                ? t('peer_review.learner.review_another')
                : t('peer_review.learner.start_review', { n: progress.current, m: progress.required })}
          </Button>
          {progress.complete && state.steps.feedback.unlocked && (
            <Button variant='primary' icon={<ArrowRight size={14} className='rtl:rotate-180' />} onClick={onGoToFeedback}>
              {t('peer_review.learner.see_feedback')}
            </Button>
          )}
        </div>
      )}

      {state.given_stats?.avg_helpfulness != null && state.given_stats.done > 0 && (
        <p className='text-xs text-neutral-500'>
          {t('peer_review.learner.your_helpfulness', { avg: Number(state.given_stats.avg_helpfulness).toFixed(1) })}
        </p>
      )}
    </div>
  )
}
