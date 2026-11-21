'use client'
import React, { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle, NotePencil } from '@phosphor-icons/react'
import { TEXTAREA } from '@/design'
import type { PeerReviewCriterion, PeerReviewPrompt, PeerReviewComments, PeerReviewScores } from '@services/courses/peerReview'
import { promptStatus, sortedLevels } from './peerReviewLogic'

// ─── Level cards (a radio group per criterion) ───────────────────────────────

export function RubricLevels({
  criterion,
  value,
  onChange,
  disabled,
  error,
  index,
}: {
  criterion: PeerReviewCriterion
  value: string | undefined
  onChange: (_levelId: string) => void
  disabled?: boolean
  error?: boolean
  index?: number
}) {
  const { t } = useTranslation()
  const name = useId()
  const levels = sortedLevels(criterion)
  return (
    <fieldset className='min-w-0' aria-invalid={error || undefined}>
      <legend className='flex w-full items-baseline gap-2'>
        {typeof index === 'number' && (
          <span className='text-[11px] font-semibold uppercase tracking-wide text-neutral-400 tabular-nums'>
            {t('peer_review.common.criterion_n', { n: index + 1 })}
          </span>
        )}
      </legend>
      <p className='text-sm font-semibold text-neutral-900 break-words'>{criterion.title}</p>
      {criterion.description && <p className='mt-0.5 text-sm text-neutral-500 whitespace-pre-wrap break-words'>{criterion.description}</p>}
      {error && <p className='mt-1 text-xs font-medium text-rose-600'>{t('peer_review.learner.pick_a_level')}</p>}
      <div className={`mt-2.5 grid gap-2 ${levels.length === 3 ? '@lg:grid-cols-3' : levels.length > 1 ? '@sm:grid-cols-2' : ''}`}>
        {levels.map((level) => {
          const checked = value === level.id
          return (
            <label
              key={level.id}
              className={`relative flex cursor-pointer flex-col gap-1 rounded-xl p-3 ring-1 ring-inset transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-teal-500 ${
                checked
                  ? 'bg-teal-50 ring-teal-500/60'
                  : error
                    ? 'bg-white ring-rose-200 hover:bg-neutral-50'
                    : 'bg-white ring-neutral-200 hover:bg-neutral-50'
              } ${disabled ? 'cursor-default opacity-70' : ''}`}
            >
              <input
                type='radio'
                name={name}
                value={level.id}
                checked={checked}
                disabled={disabled}
                onChange={() => onChange(level.id)}
                className='sr-only'
              />
              <span className='flex items-center justify-between gap-2'>
                <span className={`text-sm font-semibold ${checked ? 'text-teal-900' : 'text-neutral-800'}`}>{level.label}</span>
                <span className={`flex items-center gap-1 text-xs font-semibold tabular-nums ${checked ? 'text-teal-700' : 'text-neutral-400'}`}>
                  {checked && <CheckCircle size={14} weight='fill' aria-hidden='true' />}
                  {t('peer_review.common.points_short', { count: level.points })}
                </span>
              </span>
              {level.description && (
                <span className={`text-xs leading-relaxed ${checked ? 'text-teal-800/80' : 'text-neutral-500'}`}>{level.description}</span>
              )}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

// ─── Prompt box with a live min-chars counter ────────────────────────────────

export function PromptBox({
  prompt,
  value,
  onChange,
  disabled,
  showError,
  rows = 3,
}: {
  prompt: PeerReviewPrompt
  value: string
  onChange: (_value: string) => void
  disabled?: boolean
  showError?: boolean
  rows?: number
}) {
  const { t } = useTranslation()
  const id = useId()
  const status = promptStatus(value, prompt.min_chars)
  const invalid = !!showError && !status.ok
  return (
    <div className='flex flex-col gap-1.5'>
      <label htmlFor={id} className='text-sm font-semibold text-neutral-800'>
        {prompt.label}
      </label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid || undefined}
        aria-describedby={`${id}-count`}
        className={`${TEXTAREA} ${invalid ? 'ring-rose-300' : ''}`}
      />
      <p
        id={`${id}-count`}
        aria-live='polite'
        className={`text-xs tabular-nums ${status.min === 0 ? 'text-neutral-400' : status.ok ? 'text-emerald-600' : invalid ? 'text-rose-600' : 'text-neutral-400'}`}
      >
        {status.min === 0
          ? t('peer_review.learner.optional')
          : status.ok
            ? t('peer_review.learner.chars_ok', { count: status.count })
            : t('peer_review.learner.chars_remaining', { count: status.remaining })}
      </p>
    </div>
  )
}

// ─── Optional note under a criterion ─────────────────────────────────────────

function CriterionNote({ value, onChange, disabled }: { value: string; onChange: (_value: string) => void; disabled?: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(!!value)
  const id = useId()
  if (!open) {
    return (
      <button
        type='button'
        disabled={disabled}
        onClick={() => setOpen(true)}
        className='mt-2 flex w-fit items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs font-semibold text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20'
      >
        <NotePencil size={13} aria-hidden='true' />
        {t('peer_review.learner.add_note')}
      </button>
    )
  }
  return (
    <div className='mt-2 flex flex-col gap-1'>
      <label htmlFor={id} className='text-xs font-medium text-neutral-500'>
        {t('peer_review.learner.note_label')}
      </label>
      <textarea id={id} rows={2} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={TEXTAREA} />
    </div>
  )
}

// ─── The whole form ──────────────────────────────────────────────────────────

export function RubricForm({
  rubric,
  prompts,
  scores,
  comments,
  criterionComments,
  onScore,
  onComment,
  onCriterionComment,
  showErrors,
  disabled,
}: {
  rubric: PeerReviewCriterion[]
  prompts?: PeerReviewPrompt[]
  scores: PeerReviewScores
  comments?: PeerReviewComments
  criterionComments?: PeerReviewComments
  onScore: (_criterionId: string, _levelId: string) => void
  onComment?: (_key: string, _text: string) => void
  onCriterionComment?: (_criterionId: string, _text: string) => void
  showErrors?: boolean
  disabled?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className='@container flex flex-col gap-5'>
      <div className='flex flex-col gap-5'>
        {rubric.map((criterion, i) => (
          <div key={criterion.id} className='flex flex-col'>
            <RubricLevels
              criterion={criterion}
              index={i}
              value={scores[criterion.id]}
              onChange={(levelId) => onScore(criterion.id, levelId)}
              disabled={disabled}
              error={showErrors && !criterion.levels.some((l) => l.id === scores[criterion.id])}
            />
            {onCriterionComment && (
              <CriterionNote
                value={criterionComments?.[criterion.id] ?? ''}
                onChange={(v) => onCriterionComment(criterion.id, v)}
                disabled={disabled}
              />
            )}
          </div>
        ))}
      </div>
      {prompts && prompts.length > 0 && onComment && (
        <div className='flex flex-col gap-4 border-t border-neutral-100 pt-5'>
          <p className='text-[11px] font-semibold uppercase tracking-wide text-neutral-400'>{t('peer_review.learner.comments_heading')}</p>
          {prompts.map((p) => (
            <PromptBox
              key={p.key}
              prompt={p}
              value={comments?.[p.key] ?? ''}
              onChange={(v) => onComment(p.key, v)}
              disabled={disabled}
              showError={showErrors}
            />
          ))}
        </div>
      )}
    </div>
  )
}
