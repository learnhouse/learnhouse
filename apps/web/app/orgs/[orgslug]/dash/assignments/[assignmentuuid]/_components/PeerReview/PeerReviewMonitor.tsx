'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CaretRight, ChatCircleText, Flag, Prohibit, Target, Tray, UsersThree, WarningCircle } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { Button, Chip, EmptyState, Panel, SectionCard, Skeleton, StatCard, TEXTAREA, recipes } from '@/design'
import { queryKeys } from '@/lib/query/keys'
import { detailMessage } from '@services/utils/ts/requests'
import type { PeerReview, PeerReviewPrompt, PeerReviewSettings, PeerReviewSubmissionRow } from '@services/courses/peerReview'
import { discardPeerReviewAsInstructor, fetchPeerReviewOverview } from '@services/courses/peerReviewAdmin'
import { isOutlierSpread } from '@/lib/assignments/peerReviewRubric'
import SubmissionReviewsDrawer from './SubmissionReviewsDrawer'
import { InfoTip, ProgressTrack, Stars, formatPct, partyName } from './ui'

// Monitor: how far the review round has got, who needs a look, and which
// reviewers write useful reviews.

const SUB_COLS = 'grid grid-cols-[minmax(0,1fr)_7rem_4.5rem] sm:grid-cols-[minmax(0,1fr)_9rem_6rem_4.5rem_4rem_1rem] gap-3 items-center'
const REV_COLS = 'grid grid-cols-[minmax(0,1fr)_5rem_6.5rem] sm:grid-cols-[minmax(0,1fr)_6rem_7.5rem_5rem_6rem] gap-3 items-center'

function QuickDiscard({ review, assignmentUuid, onDone }: { review: PeerReview; assignmentUuid: string; onDone: () => void }) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const [open, setOpen] = React.useState(false)
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  if (!open) {
    return (
      <Button size='sm' variant='danger-ghost' icon={<Prohibit size={13} />} onClick={() => { setReason(review.flag_reason || ''); setOpen(true) }}>
        {t('peer_review.instructor.drawer.discard')}
      </Button>
    )
  }
  return (
    <div className='flex flex-col gap-2 w-full'>
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
        <Button size='sm' variant='ghost' onClick={() => setOpen(false)} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button
          size='sm'
          variant='danger'
          loading={busy}
          disabled={!reason.trim()}
          onClick={async () => {
            setBusy(true)
            try {
              await discardPeerReviewAsInstructor(assignmentUuid, review.review_uuid, reason.trim(), accessToken)
              toast.success(t('peer_review.instructor.drawer.discarded_toast'))
              setOpen(false)
              onDone()
            } catch (e: any) {
              toast.error(detailMessage(e?.detail, t('peer_review.instructor.drawer.action_error')))
            } finally {
              setBusy(false)
            }
          }}
        >
          {t('peer_review.instructor.drawer.discard')}
        </Button>
      </div>
    </div>
  )
}

export default function PeerReviewMonitor({
  assignmentUuid,
  settings,
  prompts,
  ungraded,
  onGoToSetup,
}: {
  assignmentUuid: string
  settings: PeerReviewSettings
  prompts: PeerReviewPrompt[]
  ungraded: boolean
  onGoToSetup: () => void
}) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const [openRow, setOpenRow] = React.useState<PeerReviewSubmissionRow | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.peerReview.overview(assignmentUuid),
    queryFn: () => fetchPeerReviewOverview(assignmentUuid, accessToken),
    enabled: !!accessToken,
    staleTime: 15_000,
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.peerReview.all(assignmentUuid) })
  const closeDrawer = React.useCallback(() => setOpenRow(null), [])

  if (!settings.enabled && !(data?.submissions?.length)) {
    return (
      <Panel>
        <EmptyState
          icon={<UsersThree size={22} />}
          title={t('peer_review.instructor.monitor.off_title')}
          description={t('peer_review.instructor.monitor.off_description')}
          action={<Button variant='primary' size='sm' onClick={onGoToSetup}>{t('peer_review.instructor.monitor.go_setup')}</Button>}
        />
      </Panel>
    )
  }

  if (isError) {
    return (
      <Panel>
        <EmptyState
          icon={<WarningCircle size={22} />}
          title={t('peer_review.instructor.error_title')}
          description={t('peer_review.instructor.error_description')}
          action={<Button size='sm' onClick={() => refetch()}>{t('peer_review.instructor.retry')}</Button>}
        />
      </Panel>
    )
  }

  const totals = data?.totals
  const submissions = data?.submissions || []
  const reviewers = data?.reviewers || []
  const target = settings.reviews_required
  const flaggedReviews = (data?.flagged || []).filter((r) => r.status !== 'discarded')
  // Older API builds may not list flagged reviews; fall back to the learners who have some.
  const flaggedRows = flaggedReviews.length === 0 ? submissions.filter((s) => s.flagged_count > 0) : []
  const rowForUser = (userId?: number | null) => submissions.find((s) => s.user_id === userId) || null

  return (
    <div className='flex flex-col gap-4'>
      <div className='grid grid-cols-2 lg:grid-cols-5 gap-3'>
        <StatCard icon={<Tray size={18} />} iconClass='bg-sky-50 text-sky-600' label={t('peer_review.instructor.totals.submitted')} value={totals ? totals.submitted_learners : null} />
        <StatCard icon={<ChatCircleText size={18} />} iconClass='bg-emerald-50 text-emerald-600' label={t('peer_review.instructor.totals.reviews_done')} value={totals ? totals.reviews_submitted : null} />
        <StatCard icon={<UsersThree size={18} />} iconClass='bg-neutral-100 text-neutral-600' label={t('peer_review.instructor.totals.in_progress')} value={totals ? totals.reviews_assigned : null} />
        <StatCard icon={<Target size={18} />} iconClass='bg-amber-50 text-amber-600' label={t('peer_review.instructor.totals.below_target')} value={totals ? totals.below_target : null} />
        <StatCard icon={<Flag size={18} />} iconClass='bg-rose-50 text-rose-600' label={t('peer_review.instructor.totals.flagged')} value={totals ? totals.flagged : null} />
      </div>

      {/* Flagged reviews first: they are the only thing that needs action. */}
      {(flaggedReviews.length > 0 || flaggedRows.length > 0) && (
        <SectionCard
          icon={<Flag size={18} />}
          title={t('peer_review.instructor.flagged.title')}
          description={t('peer_review.instructor.flagged.description')}
          bodyClassName='p-5 flex flex-col gap-3'
        >
          {flaggedReviews.map((review) => {
            const row = rowForUser(review.reviewee?.user_id)
            return (
              <div key={review.review_uuid} className='rounded-xl ring-1 ring-inset ring-rose-600/10 bg-rose-50/40 p-3 flex flex-col gap-2'>
                <div className='flex flex-wrap items-center gap-x-2 gap-y-1 text-sm'>
                  <span className='font-semibold text-neutral-900'>{partyName(review.reviewer, t('peer_review.instructor.unknown_learner'))}</span>
                  <CaretRight size={12} className='text-neutral-400 rtl:rotate-180' />
                  <span className='text-neutral-700'>{partyName(review.reviewee, t('peer_review.instructor.unknown_learner'))}</span>
                </div>
                {review.flag_reason && <p className='text-sm text-rose-800 break-words'>“{review.flag_reason}”</p>}
                <div className='flex flex-wrap items-center justify-end gap-2'>
                  {row && (
                    <Button size='sm' variant='ghost' onClick={() => setOpenRow(row)}>
                      {t('peer_review.instructor.flagged.open')}
                    </Button>
                  )}
                  <QuickDiscard review={review} assignmentUuid={assignmentUuid} onDone={refresh} />
                </div>
              </div>
            )
          })}
          {flaggedRows.map((row) => (
            <button
              key={row.user_id}
              type='button'
              onClick={() => setOpenRow(row)}
              className='rounded-xl ring-1 ring-inset ring-rose-600/10 bg-rose-50/40 p-3 flex items-center justify-between gap-3 text-start hover:bg-rose-50'
            >
              <span className='text-sm font-semibold text-neutral-900 truncate'>{partyName(row.user, t('peer_review.instructor.unknown_learner'))}</span>
              <Chip tone='rose' icon={<Flag size={12} />}>{t('peer_review.instructor.flagged.count', { n: row.flagged_count })}</Chip>
            </button>
          ))}
        </SectionCard>
      )}

      {/* Submissions */}
      <div className='flex flex-col gap-2'>
        <h2 className={recipes.sectionTitle}>{t('peer_review.instructor.submissions.title')}</h2>
        <Panel divided>
          <div className={`${recipes.tableHead} ${SUB_COLS}`}>
            <span>{t('peer_review.instructor.submissions.learner')}</span>
            <span>{t('peer_review.instructor.submissions.reviews')}</span>
            <span><InfoTip label={t('peer_review.instructor.submissions.peer_score')} tip={t('peer_review.instructor.submissions.peer_score_tip')} /></span>
            <span className='hidden sm:inline'><InfoTip label={t('peer_review.instructor.submissions.self')} tip={t('peer_review.instructor.submissions.self_tip')} /></span>
            <span className='hidden sm:inline'>{t('peer_review.instructor.submissions.flags')}</span>
            <span className='hidden sm:inline' />
          </div>
          {isLoading ? (
            [0, 1, 2, 3].map((i) => (
              <div key={i} className='px-5 py-4'><Skeleton className='h-5 w-full' /></div>
            ))
          ) : submissions.length === 0 ? (
            <EmptyState icon={<Tray size={22} />} title={t('peer_review.instructor.submissions.empty_title')} description={t('peer_review.instructor.submissions.empty_description')} />
          ) : (
            submissions.map((row) => {
              const spread = row.peer_score?.spread ?? row.spread
              const rowTarget = (row as PeerReviewSubmissionRow & { reviews_target?: number }).reviews_target ?? target
              return (
                <button
                  key={row.user_id}
                  type='button'
                  onClick={() => setOpenRow(row)}
                  className={`${SUB_COLS} w-full px-5 py-3.5 text-start hover:bg-neutral-50/70 transition-colors ${recipes.focusRing}`}
                >
                  <span className='min-w-0 flex flex-col gap-1'>
                    <span className='text-sm font-semibold text-neutral-900 truncate'>{partyName(row.user, t('peer_review.instructor.unknown_learner'))}</span>
                    {isOutlierSpread(spread) && (
                      <span>
                        <Chip tone='amber' icon={<WarningCircle size={12} />} title={t('peer_review.instructor.submissions.disagree_tip')}>
                          {t('peer_review.instructor.submissions.disagree', { points: Math.round(spread as number) })}
                        </Chip>
                      </span>
                    )}
                  </span>
                  <span className='flex flex-col gap-1.5'>
                    <span className='text-xs font-semibold text-neutral-700 tabular-nums'>{t('peer_review.instructor.submissions.received', { done: row.reviews_received, target: rowTarget })}</span>
                    <ProgressTrack value={row.reviews_received} target={rowTarget} />
                  </span>
                  <span className='text-sm font-bold text-neutral-900 tabular-nums'>
                    {row.peer_score ? formatPct(row.peer_score.percentage) : <span className='text-xs font-normal text-neutral-400'>{t('peer_review.instructor.submissions.waiting')}</span>}
                  </span>
                  <span className='hidden sm:inline text-sm text-neutral-600 tabular-nums'>{formatPct(row.self_score)}</span>
                  <span className='hidden sm:inline'>
                    {row.flagged_count > 0 ? <Chip tone='rose' icon={<Flag size={12} />}>{row.flagged_count}</Chip> : <span className='text-neutral-300'>—</span>}
                  </span>
                  <CaretRight size={14} className='hidden sm:inline text-neutral-300 rtl:rotate-180' />
                </button>
              )
            })
          )}
        </Panel>
      </div>

      {/* Reviewers */}
      <div className='flex flex-col gap-2'>
        <h2 className={recipes.sectionTitle}>{t('peer_review.instructor.reviewers.title')}</h2>
        <Panel divided>
          <div className={`${recipes.tableHead} ${REV_COLS}`}>
            <span>{t('peer_review.instructor.reviewers.reviewer')}</span>
            <span><InfoTip label={t('peer_review.instructor.reviewers.done')} tip={t('peer_review.instructor.reviewers.done_tip')} /></span>
            <span><InfoTip label={t('peer_review.instructor.reviewers.helpfulness')} tip={t('peer_review.instructor.reviewers.helpfulness_tip')} /></span>
            <span className='hidden sm:inline'><InfoTip label={t('peer_review.instructor.reviewers.bias')} tip={t('peer_review.instructor.reviewers.bias_tip')} /></span>
            <span className='hidden sm:inline'><InfoTip label={t('peer_review.instructor.reviewers.calibration')} tip={t('peer_review.instructor.reviewers.calibration_tip')} /></span>
          </div>
          {isLoading ? (
            [0, 1, 2].map((i) => (
              <div key={i} className='px-5 py-4'><Skeleton className='h-5 w-full' /></div>
            ))
          ) : reviewers.length === 0 ? (
            <EmptyState icon={<UsersThree size={22} />} title={t('peer_review.instructor.reviewers.empty_title')} description={t('peer_review.instructor.reviewers.empty_description')} />
          ) : (
            reviewers.map((r) => {
              const required = r.reviews_required || target
              const done = r.reviews_done >= required
              return (
                <div key={r.user_id} className={`${REV_COLS} px-5 py-3.5`}>
                  <span className='text-sm font-semibold text-neutral-900 truncate'>{partyName(r.user, t('peer_review.instructor.unknown_learner'))}</span>
                  <span className={`text-sm font-semibold tabular-nums ${done ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {r.reviews_done}/{required}
                  </span>
                  <span>
                    {settings.helpfulness_enabled || typeof r.avg_helpfulness === 'number' ? (
                      <Stars value={r.avg_helpfulness} label={typeof r.avg_helpfulness === 'number' ? t('peer_review.instructor.reviewers.helpfulness_value', { value: r.avg_helpfulness.toFixed(1) }) : ''} />
                    ) : (
                      <span className='text-neutral-300'>—</span>
                    )}
                  </span>
                  <span className={`hidden sm:inline text-sm tabular-nums ${typeof r.bias === 'number' && r.bias >= 20 ? 'text-amber-700 font-semibold' : 'text-neutral-600'}`}>
                    {typeof r.bias === 'number' ? t('peer_review.instructor.reviewers.bias_value', { points: Math.round(r.bias) }) : '—'}
                  </span>
                  <span className='hidden sm:inline text-sm text-neutral-600 tabular-nums'>
                    {typeof r.calibration_deviation === 'number' ? t('peer_review.instructor.reviewers.calibration_value', { points: r.calibration_deviation.toFixed(1) }) : '—'}
                  </span>
                </div>
              )
            })
          )}
        </Panel>
      </div>

      <SubmissionReviewsDrawer assignmentUuid={assignmentUuid} row={openRow} settings={settings} prompts={prompts} ungraded={ungraded} onClose={closeDrawer} />
    </div>
  )
}
