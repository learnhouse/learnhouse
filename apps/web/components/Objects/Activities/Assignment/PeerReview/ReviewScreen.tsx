'use client'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowLeft, CheckCircle, CloudCheck, FloppyDisk, PaperPlaneTilt, UserCircle, WarningCircle } from '@phosphor-icons/react'
import { Button, EmptyState, Skeleton } from '@/design'
import { queryKeys } from '@/lib/query/keys'
import {
  isPeerReviewRetrying,
  getPeerReview,
  savePeerReview,
  type PeerReviewAnonymity,
  type PeerReviewComments,
  type PeerReviewCriterion,
  type PeerReviewPrompt,
  type PeerReviewScores,
} from '@services/courses/peerReview'
import { RubricForm } from './RubricForm'
import SubmissionViewer from './SubmissionViewer'
import { validateReview, type ReviewProgress } from './peerReviewLogic'
import { useAccessToken, useErrorToast, useInvalidatePeerReview } from './usePeerReview'

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

const AUTOSAVE_MS = 1500

export default function ReviewScreen({
  assignmentUuid,
  reviewUuid,
  rubric: fallbackRubric,
  prompts,
  anonymity,
  progress,
  onBack,
  onSubmitted,
}: {
  assignmentUuid: string
  reviewUuid: string
  rubric: PeerReviewCriterion[]
  prompts: PeerReviewPrompt[]
  anonymity: PeerReviewAnonymity
  progress: ReviewProgress
  onBack: () => void
  onSubmitted: () => void
}) {
  const { t } = useTranslation()
  const accessToken = useAccessToken()
  const toastError = useErrorToast()
  const invalidate = useInvalidatePeerReview(assignmentUuid)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.peerReview.review(reviewUuid),
    queryFn: () => getPeerReview(reviewUuid, accessToken as string),
    enabled: !!(reviewUuid && accessToken),
    staleTime: 0,
  })

  const rubric = data?.rubric?.length ? data.rubric : fallbackRubric
  const review = data?.review
  const submissionChanged = !!data?.submission_changed
  const readOnly = review?.status === 'submitted' || review?.status === 'discarded' || submissionChanged

  const [scores, setScores] = useState<PeerReviewScores>({})
  const [comments, setComments] = useState<PeerReviewComments>({})
  const [criterionComments, setCriterionComments] = useState<PeerReviewComments>({})
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [showErrors, setShowErrors] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const hydrated = useRef(false)

  // Hydrate once from the server draft so a reload continues where it stopped.
  useEffect(() => {
    if (!review || hydrated.current) return
    hydrated.current = true
    setScores({ ...(review.scores || {}) })
    setComments({ ...(review.comments || {}) })
    setCriterionComments({ ...(review.criterion_comments || {}) })
  }, [review])

  // Latest values for the debounced / unmount save.
  const latest = useRef({ scores, comments, criterionComments })
  useEffect(() => {
    latest.current = { scores, comments, criterionComments }
  }, [scores, comments, criterionComments])
  const dirtyRef = useRef(false)
  const inFlight = useRef<Promise<unknown> | null>(null)

  const saveDraft = useCallback(
    async (opts: { quiet?: boolean } = {}) => {
      if (!accessToken || readOnly) return true
      // Serialize: wait for a running save so drafts never land out of order.
      if (inFlight.current) await inFlight.current.catch(() => undefined)
      const snapshot = latest.current
      dirtyRef.current = false
      setSaveState('saving')
      const p = savePeerReview(
        reviewUuid,
        { scores: snapshot.scores, comments: snapshot.comments, criterion_comments: snapshot.criterionComments, submit: false },
        accessToken
      )
      inFlight.current = p
      try {
        await p
        setSaveState(dirtyRef.current ? 'dirty' : 'saved')
        return true
      } catch (e) {
        dirtyRef.current = true
        setSaveState('error')
        if (!opts.quiet) toastError(isPeerReviewRetrying(e) ? new Error(t('peer_review.learner.retry_in_progress')) : e, 'peer_review.learner.error_save')
        return false
      } finally {
        if (inFlight.current === p) inFlight.current = null
      }
    },
    [accessToken, readOnly, reviewUuid, toastError, t]
  )

  // Optimistic edits: state changes at once, the draft follows in the background.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const markDirty = useCallback(() => {
    dirtyRef.current = true
    setSaveState('dirty')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void saveDraft({ quiet: true })
    }, AUTOSAVE_MS)
  }, [saveDraft])

  // Flush a pending draft when leaving the screen.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      if (dirtyRef.current) void saveDraft({ quiet: true })
    },
    [saveDraft]
  )

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  const validation = useMemo(() => validateReview(rubric, prompts, scores, comments), [rubric, prompts, scores, comments])

  const submit = async () => {
    if (!accessToken) return
    if (!validation.ok) {
      setShowErrors(true)
      toast.error(t('peer_review.learner.fix_before_submit'))
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>('[data-peer-review-form] [aria-invalid="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
      return
    }
    if (timer.current) clearTimeout(timer.current)
    setSubmitting(true)
    try {
      if (inFlight.current) await inFlight.current.catch(() => undefined)
      await savePeerReview(reviewUuid, { scores, comments, criterion_comments: criterionComments, submit: true }, accessToken)
      dirtyRef.current = false
      toast.success(t('peer_review.learner.review_submitted_toast'))
      await invalidate()
      onSubmitted()
    } catch (e) {
      toastError(isPeerReviewRetrying(e) ? new Error(t('peer_review.learner.retry_in_progress')) : e, 'peer_review.learner.error_submit')
    } finally {
      setSubmitting(false)
    }
  }

  // Hidden parties only carry the server's English label ("Classmate"), so
  // fall back to our own translated heading instead of showing it.
  const revieweeName =
    anonymity !== 'double_blind' && data?.reviewee
      ? [data.reviewee.first_name, data.reviewee.last_name].filter(Boolean).join(' ') || data.reviewee.username || null
      : null

  const backButton = (
    <Button size='sm' onClick={onBack} icon={<ArrowLeft size={14} className='rtl:rotate-180' />}>
      {t('peer_review.learner.back')}
    </Button>
  )

  if (isLoading) {
    return (
      <div className='flex flex-col gap-3' aria-busy='true'>
        <Skeleton className='h-5 w-40' />
        <div className='grid gap-4 lg:grid-cols-2'>
          <Skeleton className='h-64' />
          <Skeleton className='h-64' />
        </div>
      </div>
    )
  }

  if (isPeerReviewRetrying(error)) {
    return (
      <div className='flex flex-col gap-3'>
        <div>{backButton}</div>
        <EmptyState icon={<WarningCircle size={22} />} title={t('peer_review.learner.retry_in_progress')} />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className='flex flex-col gap-3'>
        <div>{backButton}</div>
        <EmptyState
          icon={<WarningCircle size={22} />}
          title={t('peer_review.learner.review_load_error')}
          action={<Button size='sm' onClick={() => refetch()}>{t('peer_review.learner.retry')}</Button>}
        />
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        {backButton}
        <p className='text-sm font-semibold text-neutral-700 tabular-nums'>
          {progress.extra
            ? t('peer_review.learner.extra_review')
            : t('peer_review.learner.review_n_of_m', { n: Math.min(progress.current, progress.required), m: progress.required })}
        </p>
      </div>

      <div className='grid gap-4 lg:grid-cols-2 lg:items-start'>
        {/* Classmate's work: top on phones, start column on wide screens. */}
        <section aria-labelledby='peer-work-title' className='min-w-0 rounded-2xl bg-neutral-50/70 p-3.5 sm:p-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto'>
          <div className='mb-3 flex items-center gap-2'>
            <UserCircle size={18} className='text-neutral-400' aria-hidden='true' />
            <h4 id='peer-work-title' className='text-sm font-semibold text-neutral-900'>
              {revieweeName ? t('peer_review.learner.work_of', { name: revieweeName }) : t('peer_review.learner.classmate_work')}
            </h4>
          </div>
          <div className='rounded-xl bg-white p-1'>
            <SubmissionViewer tasks={data.tasks ?? []} reviewUuid={reviewUuid} />
          </div>
        </section>

        <section aria-labelledby='peer-form-title' className='min-w-0 flex flex-col gap-4' data-peer-review-form>
          <div>
            <h4 id='peer-form-title' className='text-sm font-semibold text-neutral-900'>{t('peer_review.learner.your_review')}</h4>
            <p className='text-sm text-neutral-500'>{t('peer_review.learner.your_review_hint')}</p>
          </div>

          {(submissionChanged || review?.status === 'discarded') && review?.status !== 'submitted' && (
            <div className='flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm font-medium text-amber-800'>
              <WarningCircle size={16} className='mt-0.5 shrink-0' aria-hidden='true' />
              {t('peer_review.learner.submission_changed')}
            </div>
          )}

          {review?.status === 'submitted' && (
            <div className='flex items-center gap-2 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm font-medium text-emerald-800'>
              <CheckCircle size={16} weight='fill' aria-hidden='true' />
              {t('peer_review.learner.review_already_submitted')}
            </div>
          )}

          <RubricForm
            rubric={rubric}
            prompts={prompts}
            scores={scores}
            comments={comments}
            criterionComments={criterionComments}
            onScore={(cid, lid) => {
              setScores((s) => ({ ...s, [cid]: lid }))
              markDirty()
            }}
            onComment={(k, v) => {
              setComments((c) => ({ ...c, [k]: v }))
              markDirty()
            }}
            onCriterionComment={(cid, v) => {
              setCriterionComments((c) => ({ ...c, [cid]: v }))
              markDirty()
            }}
            showErrors={showErrors}
            disabled={readOnly || submitting}
          />

          {!readOnly && (
            <div className='sticky bottom-3 z-10 flex flex-wrap items-center gap-2 rounded-2xl bg-white/95 p-3 nice-shadow backdrop-blur'>
              <SaveIndicator state={saveState} />
              <div className='ms-auto flex flex-wrap items-center gap-2'>
                <Button
                  size='sm'
                  icon={<FloppyDisk size={14} />}
                  loading={saveState === 'saving' && !submitting}
                  disabled={submitting}
                  onClick={async () => {
                    if (timer.current) clearTimeout(timer.current)
                    const ok = await saveDraft()
                    if (ok) toast.success(t('peer_review.learner.draft_saved_toast'))
                  }}
                >
                  {t('peer_review.learner.save_draft')}
                </Button>
                <Button variant='primary' size='sm' icon={<PaperPlaneTilt size={14} />} loading={submitting} onClick={submit}>
                  {t('peer_review.learner.submit_review')}
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function SaveIndicator({ state }: { state: SaveState }) {
  const { t } = useTranslation()
  if (state === 'idle') return <span className='text-xs text-neutral-400'>{t('peer_review.learner.drafts_autosave')}</span>
  if (state === 'saving') return <span className='text-xs text-neutral-500' aria-live='polite'>{t('peer_review.learner.saving')}</span>
  if (state === 'saved')
    return (
      <span className='flex items-center gap-1 text-xs font-medium text-emerald-600' aria-live='polite'>
        <CloudCheck size={14} aria-hidden='true' />
        {t('peer_review.learner.saved')}
      </span>
    )
  if (state === 'error')
    return (
      <span className='flex items-center gap-1 text-xs font-medium text-rose-600' aria-live='polite'>
        <WarningCircle size={14} aria-hidden='true' />
        {t('peer_review.learner.not_saved')}
      </span>
    )
  return (
    <span className='flex items-center gap-1.5 text-xs text-amber-700'>
      <span className='h-1.5 w-1.5 rounded-full bg-amber-400' aria-hidden='true' />
      {t('peer_review.learner.unsaved')}
    </span>
  )
}
