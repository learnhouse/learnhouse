'use client'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { CheckCircle, PencilSimple } from '@phosphor-icons/react'
import { Button } from '@/design'
import {
  submitSelfReview,
  type PeerReviewComments,
  type PeerReviewLearnerState,
  type PeerReviewScores,
} from '@services/courses/peerReview'
import { RubricForm } from './RubricForm'
import { StepIntro } from './shared'
import { reviewPercentage, sortedLevels, validateReview } from './peerReviewLogic'
import { useAccessToken, useErrorToast, useInvalidatePeerReview, usePrompts } from './usePeerReview'

export default function SelfReviewStep({
  assignmentUuid,
  state,
  onFinished,
}: {
  assignmentUuid: string
  state: PeerReviewLearnerState
  onFinished: () => void
}) {
  const { t } = useTranslation()
  const rubric = state.settings.rubric ?? []
  // The self-review has no minimum length (the server only requires every criterion).
  const allPrompts = usePrompts(state.settings.prompts)
  const prompts = useMemo(() => allPrompts.map((p) => ({ ...p, min_chars: 0 })), [allPrompts])
  const selfReview = state.self_review
  const onDone = onFinished
  const accessToken = useAccessToken()
  const toastError = useErrorToast()
  const invalidate = useInvalidatePeerReview(assignmentUuid)
  const done = selfReview?.status === 'submitted'
  const [editing, setEditing] = useState(!done)
  const [scores, setScores] = useState<PeerReviewScores>(() => ({ ...(selfReview?.scores || {}) }))
  const [comments, setComments] = useState<PeerReviewComments>(() => ({ ...(selfReview?.comments || {}) }))
  const [showErrors, setShowErrors] = useState(false)
  const [saving, setSaving] = useState(false)
  const intro = <StepIntro title={t('peer_review.learner.self_title')} why={t('peer_review.learner.self_why')} />

  if (done && !editing) {
    const pct = reviewPercentage(rubric, selfReview?.scores)
    return (
      <div className='flex flex-col gap-4'>
        {intro}
        <div className='flex items-center gap-2 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm font-medium text-emerald-800'>
          <CheckCircle size={16} weight='fill' aria-hidden='true' />
          {pct !== null ? t('peer_review.learner.self_done_pct', { pct }) : t('peer_review.learner.self_done')}
        </div>
        <ul className='flex flex-col gap-2'>
          {rubric.map((c) => {
            const level = sortedLevels(c).find((l) => l.id === selfReview?.scores?.[c.id])
            return (
              <li key={c.id} className='flex items-center justify-between gap-3 text-sm'>
                <span className='min-w-0 truncate text-neutral-700'>{c.title}</span>
                <span className='flex-none font-semibold text-neutral-900'>{level?.label ?? '—'}</span>
              </li>
            )
          })}
        </ul>
        <div className='flex flex-wrap gap-2'>
          <Button size='sm' icon={<PencilSimple size={14} />} onClick={() => setEditing(true)}>
            {t('peer_review.learner.edit_self_review')}
          </Button>
          <Button size='sm' variant='primary' onClick={onDone}>
            {t('peer_review.learner.continue')}
          </Button>
        </div>
      </div>
    )
  }

  const submit = async () => {
    if (!accessToken) return
    const v = validateReview(rubric, prompts, scores, comments)
    if (!v.ok) {
      setShowErrors(true)
      toast.error(t('peer_review.learner.fix_before_submit'))
      return
    }
    setSaving(true)
    try {
      await submitSelfReview(assignmentUuid, { scores, comments }, accessToken)
      toast.success(t('peer_review.learner.self_saved_toast'))
      setEditing(false)
      await invalidate()
      onDone()
    } catch (e) {
      toastError(e, 'peer_review.learner.error_submit')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className='flex flex-col gap-5'>
      {intro}
      <RubricForm
        rubric={rubric}
        prompts={prompts}
        scores={scores}
        comments={comments}
        onScore={(cid, lid) => setScores((s) => ({ ...s, [cid]: lid }))}
        onComment={(k, v) => setComments((c) => ({ ...c, [k]: v }))}
        showErrors={showErrors}
        disabled={saving}
      />
      <div className='flex flex-wrap justify-end gap-2'>
        {done && (
          <Button size='sm' onClick={() => setEditing(false)} disabled={saving}>
            {t('peer_review.learner.cancel')}
          </Button>
        )}
        <Button variant='primary' size='sm' loading={saving} onClick={submit}>
          {t('peer_review.learner.save_self_review')}
        </Button>
      </div>
    </div>
  )
}
