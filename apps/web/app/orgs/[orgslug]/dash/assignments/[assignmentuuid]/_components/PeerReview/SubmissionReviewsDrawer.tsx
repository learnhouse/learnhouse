'use client'
import React from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowCounterClockwise, Flag, GraduationCap, NotePencil, Prohibit, UserCircle, WarningCircle, X } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { AssignmentProvider } from '@components/Contexts/Assignments/AssignmentContext'
import { AssignmentsTaskProvider } from '@components/Contexts/Assignments/AssignmentsTaskContext'
import AssignmentSubmissionProvider from '@components/Contexts/Assignments/AssignmentSubmissionContext'
import { Button, Chip, EmptyState, Eyebrow, Modal, Skeleton, StatusPill, TEXTAREA } from '@/design'
import { queryKeys } from '@/lib/query/keys'
import { detailMessage } from '@services/utils/ts/requests'
import type { PeerReview, PeerReviewCriterion, PeerReviewPrompt, PeerReviewSettings, PeerReviewSubmissionRow } from '@services/courses/peerReview'
import {
  discardPeerReviewAsInstructor,
  fetchPeerReviewSubmission,
  restorePeerReviewAsInstructor,
} from '@services/courses/peerReviewAdmin'
import { isOutlierSpread, peerScoreMedians, reviewPercentage } from '@/lib/assignments/peerReviewRubric'
import EvaluateAssignment from '../../subpages/Modals/EvaluateAssignment'
import { Stars, formatPct, partyName } from './ui'

// Everything about one learner's peer reviews: the combined score, every
// review (names visible to instructors), discard/restore, their reflection,
// and a way into the normal grading flow. Nothing here writes a grade.

function levelFor(criterion: PeerReviewCriterion, levelId?: string) {
  return criterion.levels.find((l) => l.id === levelId) || null
}

function ReviewCard({
  review,
  index,
  rubric,
  prompts,
  assignmentUuid,
  onChanged,
  readOnly = false,
}: {
  readOnly?: boolean
  review: PeerReview
  index: number
  rubric: PeerReviewCriterion[]
  prompts: PeerReviewPrompt[]
  assignmentUuid: string
  onChanged: () => void
}) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const [discarding, setDiscarding] = React.useState(false)
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const discarded = review.status === 'discarded'
  // Closed by the system when the author started a new attempt: nothing to restore.
  const systemClosed = discarded && !review.discarded_by && review.discard_reason === 'submission_changed'
  const pct = reviewPercentage(review.scores, rubric, review.percentage)
  const name = partyName(review.reviewer, review.reviewer_label || t('peer_review.instructor.drawer.reviewer_n', { n: index + 1 }))

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(success)
      setDiscarding(false)
      setReason('')
      onChanged()
    } catch (e: any) {
      toast.error(detailMessage(e?.detail, t('peer_review.instructor.drawer.action_error')))
    } finally {
      setBusy(false)
    }
  }

  const promptLabel = (key: string) => prompts.find((p) => p.key === key)?.label || key
  const comments = Object.entries(review.comments || {}).filter(([, text]) => text?.trim())
  const criterionNotes = review.criterion_comments || {}

  return (
    <article className={`rounded-xl ring-1 ring-inset p-4 flex flex-col gap-3 ${discarded ? 'ring-neutral-200 bg-neutral-50/70' : 'ring-neutral-200 bg-white'}`}>
      <header className='flex flex-wrap items-center gap-2'>
        <UserCircle size={18} className='text-neutral-400' />
        <span className={`text-sm font-semibold ${discarded ? 'text-neutral-400 line-through' : 'text-neutral-900'}`}>{name}</span>
        {review.status === 'assigned' && <StatusPill status='neutral' dot>{t('peer_review.instructor.drawer.status_assigned')}</StatusPill>}
        {discarded && <StatusPill status='danger' dot>{t('peer_review.instructor.drawer.status_discarded')}</StatusPill>}
        {review.flagged && (
          <Chip tone='rose' icon={<Flag size={12} />}>
            {t('peer_review.instructor.drawer.flagged')}
          </Chip>
        )}
        <span className='ms-auto text-sm font-bold text-neutral-900 tabular-nums'>{formatPct(pct)}</span>
      </header>

      {review.flagged && review.flag_reason && (
        <p className='rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800'>
          <span className='font-semibold'>{t('peer_review.instructor.drawer.flag_reason')}</span> {review.flag_reason}
        </p>
      )}
      {systemClosed ? (
        <p className='rounded-lg bg-neutral-100 px-3 py-2 text-xs text-neutral-600'>{t('peer_review.instructor.drawer.closed_new_attempt')}</p>
      ) : (
        discarded &&
        review.discard_reason && (
          <p className='rounded-lg bg-neutral-100 px-3 py-2 text-xs text-neutral-600'>
            <span className='font-semibold'>{t('peer_review.instructor.drawer.discard_reason')}</span> {review.discard_reason}
          </p>
        )
      )}

      {review.status !== 'assigned' && rubric.length > 0 && (
        <dl className='flex flex-col divide-y divide-neutral-100 text-sm'>
          {rubric.map((criterion) => {
            const level = levelFor(criterion, review.scores?.[criterion.id])
            const note = criterionNotes[criterion.id]
            return (
              <div key={criterion.id} className='py-1.5'>
                <div className='flex items-baseline justify-between gap-3'>
                  <dt className='text-neutral-600 min-w-0 truncate'>{criterion.title}</dt>
                  <dd className='shrink-0 text-neutral-900 font-medium'>
                    {level ? (
                      <>
                        {level.label} <span className='text-neutral-400 tabular-nums'>· {t('peer_review.common.points_short', { count: Number(level.points) || 0 })}</span>
                      </>
                    ) : (
                      <span className='text-neutral-300'>—</span>
                    )}
                  </dd>
                </div>
                {note?.trim() && <p className='mt-0.5 text-xs text-neutral-500 whitespace-pre-wrap break-words'>{note}</p>}
              </div>
            )
          })}
        </dl>
      )}

      {comments.length > 0 && (
        <div className='flex flex-col gap-2'>
          {comments.map(([key, text]) => (
            <div key={key}>
              <p className='text-xs font-semibold text-neutral-500'>{promptLabel(key)}</p>
              <p className='text-sm text-neutral-800 whitespace-pre-wrap break-words'>{text}</p>
            </div>
          ))}
        </div>
      )}

      {typeof review.helpfulness === 'number' && (
        <div className='flex flex-wrap items-center gap-2 text-xs text-neutral-500'>
          <span>{t('peer_review.instructor.drawer.helpfulness')}</span>
          <Stars value={review.helpfulness} label={t('peer_review.instructor.reviewers.helpfulness_value', { value: review.helpfulness })} />
          {review.helpfulness_note && <span className='italic'>“{review.helpfulness_note}”</span>}
        </div>
      )}

      {review.status !== 'assigned' && !readOnly && !systemClosed && (
        <footer className='flex flex-col gap-2'>
          {discarding ? (
            <>
              <textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('peer_review.instructor.drawer.discard_placeholder')}
                aria-label={t('peer_review.instructor.drawer.discard_reason')}
                className={TEXTAREA}
                autoFocus
              />
              <div className='flex justify-end gap-2'>
                <Button size='sm' variant='ghost' onClick={() => setDiscarding(false)} disabled={busy}>
                  {t('common.cancel')}
                </Button>
                <Button
                  size='sm'
                  variant='danger'
                  loading={busy}
                  disabled={!reason.trim()}
                  onClick={() => run(() => discardPeerReviewAsInstructor(assignmentUuid, review.review_uuid, reason.trim(), accessToken), t('peer_review.instructor.drawer.discarded_toast'))}
                >
                  {t('peer_review.instructor.drawer.discard')}
                </Button>
              </div>
            </>
          ) : (
            <div className='flex justify-end'>
              {discarded ? (
                <Button
                  size='sm'
                  icon={<ArrowCounterClockwise size={13} />}
                  loading={busy}
                  onClick={() => run(() => restorePeerReviewAsInstructor(assignmentUuid, review.review_uuid, accessToken), t('peer_review.instructor.drawer.restored_toast'))}
                >
                  {t('peer_review.instructor.drawer.restore')}
                </Button>
              ) : (
                <Button size='sm' variant='danger-ghost' icon={<Prohibit size={13} />} onClick={() => setDiscarding(true)}>
                  {t('peer_review.instructor.drawer.discard')}
                </Button>
              )}
            </div>
          )}
        </footer>
      )}
    </article>
  )
}

export default function SubmissionReviewsDrawer({
  assignmentUuid,
  row,
  settings,
  prompts,
  ungraded,
  onClose,
}: {
  assignmentUuid: string
  row: PeerReviewSubmissionRow | null
  settings: PeerReviewSettings
  prompts: PeerReviewPrompt[]
  /** Formative assignment: there is no grade to apply. */
  ungraded: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const panelRef = React.useRef<HTMLDivElement>(null)
  const [grading, setGrading] = React.useState(false)
  const open = row !== null
  const userId = row?.user_id

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.peerReview.submission(assignmentUuid, userId ?? 0),
    queryFn: () => fetchPeerReviewSubmission(assignmentUuid, userId as number, accessToken),
    enabled: open && !!accessToken && userId !== undefined,
  })

  React.useEffect(() => {
    if (!open || grading) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const previous = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [open, grading, onClose])

  if (!open || !row || typeof document === 'undefined') return null

  const rubric = settings.rubric || []
  const name = partyName(data?.user || row.user, t('peer_review.instructor.unknown_learner'))
  const peerScore = data?.peer_score ?? row.peer_score
  const medians = peerScoreMedians(peerScore)
  const spread = peerScore?.spread ?? row.spread
  const selfReview = data?.self_review ?? null
  const selfPct = selfReview ? reviewPercentage(selfReview.scores, rubric, selfReview.percentage) : row.self_score
  const peerReviews = (data?.reviews || []).filter((r) => r.kind !== 'self' && r.kind !== 'calibration')
  const canSuggest = settings.score_mode === 'suggest_grade' && !ungraded
  const onChanged = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.peerReview.all(assignmentUuid) })
  }

  return createPortal(
    <>
      <div className='fixed inset-0 z-50 flex justify-end' role='dialog' aria-modal='true' aria-labelledby='peer-review-drawer-title'>
        <button type='button' aria-label={t('peer_review.instructor.drawer.close')} className='absolute inset-0 bg-neutral-900/30 backdrop-blur-[1px] cursor-default' onClick={onClose} />
        <div ref={panelRef} tabIndex={-1} className='relative h-full w-full sm:max-w-xl bg-white shadow-2xl flex flex-col outline-none animate-in fade-in duration-150'>
          <header className='flex items-start gap-3 px-4 sm:px-6 pt-5 pb-4 border-b border-neutral-100'>
            <div className='flex-1 min-w-0'>
              <p className='text-xs font-semibold text-neutral-400'>{t('peer_review.instructor.drawer.title')}</p>
              <h2 id='peer-review-drawer-title' className='mt-1 text-lg font-semibold text-neutral-900 truncate'>{name}</h2>
              <p className='mt-1 text-xs text-neutral-500 tabular-nums'>
                {t('peer_review.instructor.submissions.received', { done: row.reviews_received, target: settings.reviews_required })}
              </p>
            </div>
            <Button variant='ghost' size='icon' onClick={onClose} aria-label={t('peer_review.instructor.drawer.close')}>
              <X size={16} />
            </Button>
          </header>

          <div className='flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6 py-5 flex flex-col gap-6'>
            {/* Combined score */}
            <section className='rounded-2xl bg-neutral-50 p-4 flex flex-col gap-3'>
              <div className='flex flex-wrap items-end justify-between gap-3'>
                <div>
                  <Eyebrow>{t('peer_review.instructor.drawer.peer_score')}</Eyebrow>
                  {peerScore ? (
                    <p className='mt-1 text-3xl font-bold text-neutral-900 tabular-nums leading-none'>{formatPct(peerScore.percentage)}</p>
                  ) : (
                    <p className='mt-1 text-sm text-neutral-500'>
                      {t('peer_review.instructor.drawer.not_enough', { n: settings.min_reviews_for_score })}
                    </p>
                  )}
                  {peerScore && (
                    <p className='mt-1.5 text-xs text-neutral-500'>{t('peer_review.instructor.drawer.score_basis', { n: peerScore.review_count })}</p>
                  )}
                </div>
                <div className='flex flex-col items-end gap-1.5'>
                  {isOutlierSpread(spread) && (
                    <Chip tone='amber' icon={<WarningCircle size={12} />}>
                      {t('peer_review.instructor.submissions.disagree', { points: Math.round(spread as number) })}
                    </Chip>
                  )}
                  <span className='text-xs text-neutral-500'>
                    {t('peer_review.instructor.drawer.self_score')} <span className='font-semibold text-neutral-800 tabular-nums'>{formatPct(selfPct)}</span>
                  </span>
                </div>
              </div>

              {peerScore && rubric.length > 0 && (
                <dl className='flex flex-col gap-1 text-sm'>
                  {rubric.map((criterion) => {
                    const median = medians[criterion.id]
                    const selfLevel = selfReview ? levelFor(criterion, selfReview.scores?.[criterion.id]) : null
                    const best = Math.max(0, ...criterion.levels.map((l) => Number(l.points) || 0))
                    return (
                      <div key={criterion.id} className='flex items-baseline justify-between gap-3'>
                        <dt className='text-neutral-600 min-w-0 truncate'>{criterion.title}</dt>
                        <dd className='shrink-0 tabular-nums text-neutral-900'>
                          {typeof median === 'number' ? `${Number.isInteger(median) ? median : median.toFixed(1)} / ${best}` : '—'}
                          {selfLevel && <span className='ms-2 text-xs text-neutral-400'>{t('peer_review.instructor.drawer.self_short', { points: selfLevel.points })}</span>}
                        </dd>
                      </div>
                    )
                  })}
                </dl>
              )}

              {canSuggest && peerScore ? (
                <div className='flex flex-col gap-1.5 pt-1'>
                  <Button variant='primary' icon={<GraduationCap size={15} />} onClick={() => setGrading(true)}>
                    {t('peer_review.instructor.drawer.apply_grade', { score: formatPct(peerScore.percentage) })}
                  </Button>
                  <p className='text-xs text-neutral-500'>{t('peer_review.instructor.drawer.apply_hint')}</p>
                </div>
              ) : (
                !ungraded && (
                  <div className='flex flex-wrap items-center justify-between gap-2 pt-1'>
                    {settings.score_mode === 'feedback_only' && (
                      <p className='text-xs text-neutral-500'>{t('peer_review.instructor.drawer.feedback_only_hint')}</p>
                    )}
                    <Button size='sm' icon={<GraduationCap size={14} />} onClick={() => setGrading(true)}>
                      {t('peer_review.instructor.drawer.open_grading')}
                    </Button>
                  </div>
                )
              )}
            </section>

            {/* Reviews */}
            <section className='flex flex-col gap-3'>
              <Eyebrow as='h3'>{t('peer_review.instructor.drawer.reviews', { n: peerReviews.length })}</Eyebrow>
              {isLoading ? (
                [0, 1, 2].map((i) => <Skeleton key={i} className='h-28 w-full' />)
              ) : isError ? (
                <EmptyState
                  icon={<WarningCircle size={22} />}
                  title={t('peer_review.instructor.error_title')}
                  description={t('peer_review.instructor.error_description')}
                  action={<Button size='sm' onClick={() => refetch()}>{t('peer_review.instructor.retry')}</Button>}
                />
              ) : peerReviews.length === 0 ? (
                <p className='rounded-xl bg-neutral-50 px-4 py-6 text-center text-sm text-neutral-500'>{t('peer_review.instructor.drawer.no_reviews')}</p>
              ) : (
                peerReviews.map((review, i) => (
                  <ReviewCard key={review.review_uuid} review={review} index={i} rubric={rubric} prompts={prompts} assignmentUuid={assignmentUuid} onChanged={onChanged} />
                ))
              )}
            </section>

            {selfReview && (
              <section className='flex flex-col gap-3'>
                <Eyebrow as='h3'>{t('peer_review.instructor.drawer.self_review')}</Eyebrow>
                <ReviewCard
                  review={{ ...selfReview, reviewer: data?.user || row.user }}
                  readOnly
                  index={0}
                  rubric={rubric}
                  prompts={prompts}
                  assignmentUuid={assignmentUuid}
                  onChanged={onChanged}
                />
              </section>
            )}

            <section className='flex flex-col gap-2'>
              <Eyebrow as='h3'>{t('peer_review.instructor.drawer.reflection')}</Eyebrow>
              {data?.reflection?.plan?.trim() ? (
                <div className='rounded-xl bg-sky-50/60 ring-1 ring-inset ring-sky-600/10 px-4 py-3 flex gap-2.5'>
                  <NotePencil size={16} className='mt-0.5 text-sky-600 shrink-0' />
                  <p className='text-sm text-neutral-800 whitespace-pre-wrap break-words'>{data.reflection.plan}</p>
                </div>
              ) : (
                <p className='text-sm text-neutral-400'>{t('peer_review.instructor.drawer.no_reflection')}</p>
              )}
            </section>
          </div>
        </div>
      </div>

      {/* The normal grading flow, with the peer suggestion pinned on top. */}
      <Modal
        isDialogOpen={grading}
        onOpenChange={(next: boolean) => setGrading(next)}
        noPadding
        customWidth='md:w-[1180px]'
        customHeight='md:h-[88vh]'
        dialogTitle={t('peer_review.instructor.drawer.grade_title', { name })}
        dialogDescription={
          peerScore && canSuggest ? (
            <span className='inline-flex flex-wrap items-center gap-2'>
              <Chip tone='emerald' icon={<GraduationCap size={12} />}>
                {t('peer_review.instructor.drawer.suggested', { score: formatPct(peerScore.percentage) })}
              </Chip>
              <span>{t('peer_review.instructor.drawer.suggested_hint', { n: peerScore.review_count })}</span>
            </span>
          ) : undefined
        }
        dialogContent={
          grading ? (
            <AssignmentProvider key={row.user_id} assignment_uuid={assignmentUuid}>
              <AssignmentsTaskProvider>
                <AssignmentSubmissionProvider assignment_uuid={assignmentUuid}>
                  <EvaluateAssignment user_id={row.user_id} submission={{ submission_status: row.submission_status }} />
                </AssignmentSubmissionProvider>
              </AssignmentsTaskProvider>
            </AssignmentProvider>
          ) : null
        }
      />
    </>,
    document.body
  )
}
