'use client'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { ChatCircleText, CheckCircle, Flag, Lock, Scales, Target } from '@phosphor-icons/react'
import { Button, Chip, EmptyState, Modal, StatusPill, TEXTAREA } from '@/design'
import {
  flagPeerReview,
  ratePeerReview,
  savePeerReflection,
  type PeerReview,
  type PeerReviewCriterion,
  type PeerReviewLearnerState,
  type PeerReviewPrompt,
} from '@services/courses/peerReview'
import { StarRating, StepIntro } from './shared'
import { computeGaps, parseLocalDate, unlockDisplay, type GapRow } from './peerReviewLogic'
import { useAccessToken, useErrorToast, useFormatDate, useInvalidatePeerReview, usePrompts } from './usePeerReview'

/** Spread (max − min %) above which reviewers clearly disagreed. */
const DISAGREE_SPREAD = 25

export default function FeedbackStep({
  assignmentUuid,
  state,
  onGoToReviews,
}: {
  assignmentUuid: string
  state: PeerReviewLearnerState
  onGoToReviews: () => void
}) {
  const { t } = useTranslation()
  const formatDate = useFormatDate()
  const prompts = usePrompts(state.settings.prompts)
  const rubric = useMemo(() => state.settings.rubric ?? [], [state.settings.rubric])
  const unlock = unlockDisplay(state.steps.feedback, state.steps.reviews, state.settings.review_due_date)
  const received = useMemo(() => (state.received ?? []).filter((r) => r.status !== 'discarded'), [state.received])
  const gaps = useMemo(
    () => computeGaps(rubric, state.peer_score, received, state.self_review?.scores),
    [rubric, state.peer_score, received, state.self_review]
  )

  const intro = <StepIntro title={t('peer_review.learner.feedback_title')} why={t('peer_review.learner.feedback_why')} />

  if (unlock.state === 'locked') {
    const due = parseLocalDate(unlock.dueDate)
    return (
      <div className='flex flex-col gap-5'>
        {intro}
        <div className='flex flex-col items-start gap-3 rounded-xl bg-neutral-50 p-4'>
          <div className='flex items-start gap-2.5'>
            <Lock size={18} className='mt-0.5 shrink-0 text-neutral-400' aria-hidden='true' />
            <div className='min-w-0'>
              <p className='text-sm font-semibold text-neutral-800'>
                {unlock.remainingReviews > 0
                  ? t('peer_review.learner.locked_reviews', { count: unlock.remainingReviews })
                  : t('peer_review.learner.locked_generic')}
              </p>
              {due && (
                <p className='mt-0.5 text-sm text-neutral-500'>
                  {t('peer_review.learner.locked_due', { date: formatDate(due.at, due.hasTime) })}
                </p>
              )}
            </div>
          </div>
          {unlock.remainingReviews > 0 && (
            <Button size='sm' variant='primary' onClick={onGoToReviews}>
              {t('peer_review.learner.go_to_reviews')}
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-5'>
      {intro}
      {unlock.reason === 'due_date' && (
        <p className='text-xs text-neutral-500'>{t('peer_review.learner.unlocked_by_due_date')}</p>
      )}

      {received.length === 0 ? (
        <div className='rounded-xl bg-neutral-50'>
          <EmptyState
            icon={<ChatCircleText size={22} />}
            title={t('peer_review.learner.no_feedback_title')}
            description={t('peer_review.learner.no_feedback_body')}
          />
        </div>
      ) : (
        <>
          <PeerScoreSummary state={state} />
          <GapChart rows={gaps} hasSelf={!!state.self_review} />
          <section aria-labelledby='received-title' className='flex flex-col gap-3'>
            <h5 id='received-title' className='text-[11px] font-semibold uppercase tracking-wide text-neutral-400'>
              {t('peer_review.learner.reviews_received', { count: received.length })}
            </h5>
            {received.map((r, i) => (
              <ReceivedReview
                key={r.review_uuid}
                review={r}
                index={i}
                rubric={rubric}
                prompts={prompts}
                assignmentUuid={assignmentUuid}
                helpfulnessEnabled={state.settings.helpfulness_enabled}
              />
            ))}
          </section>
        </>
      )}

      {state.settings.revision_plan_enabled && (
        <RevisionPlan assignmentUuid={assignmentUuid} initial={state.reflection?.plan ?? ''} />
      )}
    </div>
  )
}

// ─── Peer score ──────────────────────────────────────────────────────────────

function PeerScoreSummary({ state }: { state: PeerReviewLearnerState }) {
  const { t } = useTranslation()
  const score = state.peer_score
  const min = state.settings.min_reviews_for_score ?? 3
  if (!score) {
    return (
      <p className='flex items-center gap-2 rounded-xl bg-neutral-50 px-3.5 py-2.5 text-sm text-neutral-600'>
        <Scales size={16} className='shrink-0 text-neutral-400' aria-hidden='true' />
        {t('peer_review.learner.score_needs_more', { count: min })}
      </p>
    )
  }
  return (
    <div className='flex flex-col gap-2 rounded-xl bg-sky-50/60 p-4 sm:flex-row sm:items-center sm:gap-4'>
      {score.percentage !== null && score.percentage !== undefined && (
        <p className='text-2xl font-bold text-neutral-900 tabular-nums'>{Math.round(score.percentage)}%</p>
      )}
      <div className='min-w-0 flex-1'>
        <p className='text-sm font-semibold text-neutral-800'>{t('peer_review.learner.peer_score')}</p>
        <p className='text-sm text-neutral-600'>{t('peer_review.learner.peer_score_how', { count: score.review_count })}</p>
      </div>
      {(score.spread ?? 0) >= DISAGREE_SPREAD && (
        <StatusPill status='warning'>{t('peer_review.learner.reviewers_disagree')}</StatusPill>
      )}
    </div>
  )
}

// ─── Gap visual: peer median vs your self-review ────────────────────────────

function GapChart({ rows, hasSelf }: { rows: GapRow[]; hasSelf: boolean }) {
  const { t } = useTranslation()
  if (rows.length === 0) return null
  return (
    <section aria-labelledby='gap-title' className='flex flex-col gap-3 rounded-xl ring-1 ring-inset ring-neutral-100 p-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h5 id='gap-title' className='text-sm font-semibold text-neutral-900'>
          {hasSelf ? t('peer_review.learner.gap_title') : t('peer_review.learner.gap_title_peers')}
        </h5>
        <div className='flex items-center gap-3 text-xs text-neutral-500'>
          <span className='flex items-center gap-1.5'>
            <span className='h-2.5 w-2.5 rounded-full bg-sky-500' aria-hidden='true' />
            {t('peer_review.learner.legend_peers')}
          </span>
          {hasSelf && (
            <span className='flex items-center gap-1.5'>
              <span className='h-2.5 w-2.5 rounded-full border-2 border-teal-600 bg-white' aria-hidden='true' />
              {t('peer_review.learner.legend_you')}
            </span>
          )}
        </div>
      </div>
      <ul className='flex flex-col gap-4'>
        {rows.map((row) => (
          <li key={row.criterionId} className='flex flex-col gap-1.5'>
            <div className='flex flex-wrap items-baseline justify-between gap-2'>
              <span className='min-w-0 text-sm font-medium text-neutral-800 break-words'>{row.title}</span>
              <span className='text-xs text-neutral-500 tabular-nums'>
                {t('peer_review.learner.gap_values', {
                  peers: row.peer === null ? '—' : fmt(row.peer),
                  you: row.self === null ? '—' : fmt(row.self),
                  max: fmt(row.max),
                })}
              </span>
            </div>
            <div
              className='relative h-2 rounded-full bg-neutral-100'
              role='img'
              aria-label={t('peer_review.learner.gap_aria', {
                criterion: row.title,
                peers: row.peer === null ? '—' : fmt(row.peer),
                you: row.self === null ? '—' : fmt(row.self),
                max: fmt(row.max),
              })}
            >
              {row.peerPct !== null && row.selfPct !== null && (
                <span
                  className='absolute top-0 h-2 rounded-full bg-amber-200'
                  style={{ insetInlineStart: `${Math.min(row.peerPct, row.selfPct)}%`, width: `${Math.abs(row.peerPct - row.selfPct)}%` }}
                />
              )}
              {row.peerPct !== null && (
                <span
                  className='absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-sky-500 ring-2 ring-white rtl:translate-x-1/2 ltr:-translate-x-1/2'
                  style={{ insetInlineStart: `${row.peerPct}%` }}
                />
              )}
              {row.selfPct !== null && (
                <span
                  className='absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-teal-600 bg-white rtl:translate-x-1/2 ltr:-translate-x-1/2'
                  style={{ insetInlineStart: `${row.selfPct}%` }}
                />
              )}
            </div>
            {row.direction && (
              <p className={`text-xs ${row.direction === 'aligned' ? 'text-emerald-600' : 'text-amber-700'}`}>
                {row.direction === 'aligned'
                  ? t('peer_review.learner.gap_aligned')
                  : row.direction === 'self_higher'
                    ? t('peer_review.learner.gap_self_higher')
                    : t('peer_review.learner.gap_self_lower')}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function fmt(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

// ─── One received review ─────────────────────────────────────────────────────

function ReceivedReview({
  review,
  index,
  rubric,
  prompts,
  assignmentUuid,
  helpfulnessEnabled,
}: {
  review: PeerReview
  index: number
  rubric: PeerReviewCriterion[]
  prompts: PeerReviewPrompt[]
  assignmentUuid: string
  helpfulnessEnabled: boolean
}) {
  const { t } = useTranslation()
  const accessToken = useAccessToken()
  const toastError = useErrorToast()
  const invalidate = useInvalidatePeerReview(assignmentUuid)
  const [stars, setStars] = useState<number | null>(review.helpfulness ?? null)
  const [note, setNote] = useState(review.helpfulness_note ?? '')
  const [savingNote, setSavingNote] = useState(false)
  const [flagOpen, setFlagOpen] = useState(false)
  // Named reviews carry a name; anonymous ones a server label "Reviewer N",
  // which is re-rendered in the learner's language.
  const labelNumber = Number(/(\d+)\s*$/.exec(review.reviewer_label ?? '')?.[1]) || index + 1
  const name =
    [review.reviewer?.first_name, review.reviewer?.last_name].filter(Boolean).join(' ') ||
    review.reviewer?.username ||
    t('peer_review.learner.reviewer_n', { n: labelNumber })

  const rate = async (value: number, noteText = note) => {
    if (!accessToken) return
    const previous = stars
    setStars(value) // optimistic
    try {
      await ratePeerReview(review.review_uuid, { helpfulness: value, note: noteText.trim() || null }, accessToken)
      invalidate()
      return true
    } catch (e) {
      setStars(previous)
      toastError(e)
      return false
    }
  }

  const commentPrompts = prompts.filter((p) => (review.comments?.[p.key] ?? '').trim())
  const extraComments = Object.entries(review.comments ?? {}).filter(
    ([k, v]) => !prompts.some((p) => p.key === k) && String(v ?? '').trim()
  )

  return (
    <article className='flex flex-col gap-4 rounded-xl ring-1 ring-inset ring-neutral-100 p-4'>
      <header className='flex flex-wrap items-center justify-between gap-2'>
        <p className='text-sm font-semibold text-neutral-900'>{name}</p>
        {review.flagged && <StatusPill status='warning' icon={<Flag size={12} />}>{t('peer_review.learner.flagged')}</StatusPill>}
      </header>

      <ul className='flex flex-col gap-2'>
        {rubric.map((c) => {
          const level = c.levels.find((l) => l.id === review.scores?.[c.id])
          const cnote = (review.criterion_comments?.[c.id] ?? '').trim()
          return (
            <li key={c.id} className='flex flex-col gap-1'>
              <div className='flex items-center justify-between gap-3'>
                <span className='min-w-0 text-sm text-neutral-700 break-words'>{c.title}</span>
                <Chip tone='sky' className='flex-none'>{level?.label ?? '—'}</Chip>
              </div>
              {cnote && <p className='text-sm text-neutral-500 whitespace-pre-wrap break-words'>{cnote}</p>}
            </li>
          )
        })}
      </ul>

      {(commentPrompts.length > 0 || extraComments.length > 0) && (
        <dl className='flex flex-col gap-3 border-t border-neutral-100 pt-3'>
          {commentPrompts.map((p) => (
            <div key={p.key}>
              <dt className='text-xs font-semibold text-neutral-500'>{p.label}</dt>
              <dd className='mt-0.5 text-sm leading-relaxed text-neutral-800 whitespace-pre-wrap break-words'>{review.comments[p.key]}</dd>
            </div>
          ))}
          {extraComments.map(([k, v]) => (
            <div key={k}>
              <dd className='text-sm leading-relaxed text-neutral-800 whitespace-pre-wrap break-words'>{String(v)}</dd>
            </div>
          ))}
        </dl>
      )}

      <footer className='flex flex-col gap-3 border-t border-neutral-100 pt-3'>
        {helpfulnessEnabled && (
          <div className='flex flex-col gap-2'>
            <div className='flex flex-wrap items-center gap-x-3 gap-y-1'>
              <span className='text-sm font-medium text-neutral-700'>{t('peer_review.learner.how_helpful')}</span>
              <StarRating value={stars} onChange={(v) => rate(v)} label={t('peer_review.learner.how_helpful')} />
            </div>
            {stars !== null && (
              <div className='flex flex-col gap-2 sm:flex-row sm:items-start'>
                <textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t('peer_review.learner.helpful_note_placeholder')}
                  aria-label={t('peer_review.learner.helpful_note_label')}
                  className={TEXTAREA}
                />
                <Button
                  size='sm'
                  loading={savingNote}
                  disabled={note.trim() === (review.helpfulness_note ?? '').trim()}
                  onClick={async () => {
                    setSavingNote(true)
                    const ok = await rate(stars, note)
                    setSavingNote(false)
                    if (ok) toast.success(t('peer_review.learner.thanks_feedback'))
                  }}
                >
                  {t('peer_review.learner.save_note')}
                </Button>
              </div>
            )}
          </div>
        )}
        {!review.flagged && (
          <button
            type='button'
            onClick={() => setFlagOpen(true)}
            className='flex w-fit items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs font-semibold text-neutral-500 hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20'
          >
            <Flag size={13} aria-hidden='true' />
            {t('peer_review.learner.flag_link')}
          </button>
        )}
      </footer>

      <FlagDialog open={flagOpen} onOpenChange={setFlagOpen} reviewUuid={review.review_uuid} assignmentUuid={assignmentUuid} />
    </article>
  )
}

function FlagDialog({
  open,
  onOpenChange,
  reviewUuid,
  assignmentUuid,
}: {
  open: boolean
  onOpenChange: (_open: boolean) => void
  reviewUuid: string
  assignmentUuid: string
}) {
  const { t } = useTranslation()
  const accessToken = useAccessToken()
  const toastError = useErrorToast()
  const invalidate = useInvalidatePeerReview(assignmentUuid)
  const [reason, setReason] = useState('')
  const [sending, setSending] = useState(false)
  const send = async () => {
    if (!accessToken || !reason.trim()) return
    setSending(true)
    try {
      await flagPeerReview(reviewUuid, reason.trim(), accessToken)
      toast.success(t('peer_review.learner.flag_sent'))
      onOpenChange(false)
      setReason('')
      invalidate()
    } catch (e) {
      toastError(e)
    } finally {
      setSending(false)
    }
  }
  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={onOpenChange}
      preventClose={sending}
      size='sm'
      dialogTitle={t('peer_review.learner.flag_title')}
      dialogDescription={t('peer_review.learner.flag_body')}
      dialogContent={
        <div className='flex flex-col gap-4'>
          <label className='flex flex-col gap-1.5'>
            <span className='text-sm font-semibold text-neutral-800'>{t('peer_review.learner.flag_reason')}</span>
            <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className={TEXTAREA} />
          </label>
          <div className='flex justify-end gap-2'>
            <Button size='sm' onClick={() => onOpenChange(false)} disabled={sending}>
              {t('peer_review.learner.cancel')}
            </Button>
            <Button size='sm' variant='danger' icon={<Flag size={14} />} loading={sending} disabled={!reason.trim()} onClick={send}>
              {t('peer_review.learner.flag_submit')}
            </Button>
          </div>
        </div>
      }
    />
  )
}

// ─── Revision plan ───────────────────────────────────────────────────────────

function RevisionPlan({ assignmentUuid, initial }: { assignmentUuid: string; initial: string }) {
  const { t } = useTranslation()
  const accessToken = useAccessToken()
  const toastError = useErrorToast()
  const invalidate = useInvalidatePeerReview(assignmentUuid)
  const [plan, setPlan] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [saving, setSaving] = useState(false)
  const dirty = plan.trim() !== saved.trim()
  return (
    <section aria-labelledby='revision-title' className='flex flex-col gap-2.5 rounded-xl bg-teal-50/50 p-4'>
      <div className='flex items-start gap-2.5'>
        <Target size={18} className='mt-0.5 shrink-0 text-teal-600' aria-hidden='true' />
        <div className='min-w-0'>
          <h5 id='revision-title' className='text-sm font-semibold text-neutral-900'>{t('peer_review.learner.plan_title')}</h5>
          <p className='text-sm text-neutral-600'>{t('peer_review.learner.plan_why')}</p>
        </div>
      </div>
      <textarea
        rows={4}
        value={plan}
        onChange={(e) => setPlan(e.target.value)}
        placeholder={t('peer_review.learner.plan_placeholder')}
        aria-labelledby='revision-title'
        className={TEXTAREA}
      />
      <div className='flex items-center justify-end gap-3'>
        {!dirty && saved.trim() && (
          <span className='flex items-center gap-1 text-xs font-medium text-emerald-600'>
            <CheckCircle size={14} aria-hidden='true' />
            {t('peer_review.learner.saved')}
          </span>
        )}
        <Button
          size='sm'
          variant='primary'
          loading={saving}
          disabled={!dirty || !plan.trim()}
          onClick={async () => {
            if (!accessToken) return
            setSaving(true)
            try {
              await savePeerReflection(assignmentUuid, plan.trim(), accessToken)
              setSaved(plan)
              toast.success(t('peer_review.learner.plan_saved'))
              invalidate()
            } catch (e) {
              toastError(e)
            } finally {
              setSaving(false)
            }
          }}
        >
          {t('peer_review.learner.save_plan')}
        </Button>
      </div>
    </section>
  )
}
