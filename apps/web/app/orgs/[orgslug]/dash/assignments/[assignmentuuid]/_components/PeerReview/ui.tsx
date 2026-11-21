'use client'
import React from 'react'
import type { TFunction } from 'i18next'
import { Info, Minus, Plus, Star } from '@phosphor-icons/react'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import type { PeerReviewParty } from '@services/courses/peerReview'
import type { Issue } from '@/lib/assignments/peerReviewRubric'
import { PEER_REVIEW_LIMITS } from '@/lib/assignments/peerReviewRubric'

// Small pieces shared by the peer review setup and monitor views.

const STEPPER_BTN =
  'h-7 w-7 inline-flex items-center justify-center rounded-md bg-white ring-1 ring-inset ring-neutral-200 text-neutral-600 hover:bg-neutral-50 disabled:opacity-40'
const SMALL_NUMBER =
  'h-7 w-12 text-center text-sm font-semibold text-neutral-900 bg-white rounded-md ring-1 ring-inset ring-neutral-200 focus:outline-none focus:ring-2 focus:ring-neutral-900/15 tabular-nums'

/** − [n] + control, same look as the retries stepper on the General tab. */
export function NumberStepper({
  value,
  onChange,
  min,
  max,
  label,
  disabled,
}: {
  value: number
  onChange: (_next: number) => void
  min: number
  max: number
  label: string
  disabled?: boolean
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n))
  return (
    <div className='inline-flex items-center gap-1.5'>
      <button type='button' className={STEPPER_BTN} disabled={disabled || value <= min} onClick={() => onChange(clamp(value - 1))} aria-label={`${label} −`}>
        <Minus size={12} weight='bold' />
      </button>
      <input
        type='number'
        inputMode='numeric'
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : ''}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10)
          onChange(Number.isNaN(n) ? min : clamp(n))
        }}
        className={SMALL_NUMBER}
      />
      <button type='button' className={STEPPER_BTN} disabled={disabled || value >= max} onClick={() => onChange(clamp(value + 1))} aria-label={`${label} +`}>
        <Plus size={12} weight='bold' />
      </button>
    </div>
  )
}

/** A label with an (i) that explains a metric on hover/focus. */
export function InfoTip({ label, tip }: { label: React.ReactNode; tip: string }) {
  return (
    <span className='inline-flex items-center gap-1'>
      {label}
      <ToolTip content={<span className='block max-w-[240px] leading-snug whitespace-normal'>{tip}</span>} slateBlack side='top'>
        <button type='button' aria-label={tip} className='text-neutral-400 hover:text-neutral-700 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20'>
          <Info size={13} />
        </button>
      </ToolTip>
    </span>
  )
}

/** Read-only 1–5 stars. */
export function Stars({ value, label }: { value: number | null | undefined; label: string }) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return <span className='text-neutral-300'>—</span>
  const rounded = Math.round(value)
  return (
    <span className='inline-flex items-center gap-1' role='img' aria-label={label} title={label}>
      <span className='inline-flex' aria-hidden='true'>
        {[1, 2, 3, 4, 5].map((i) => (
          <Star key={i} size={13} weight={i <= rounded ? 'fill' : 'regular'} className={i <= rounded ? 'text-amber-400' : 'text-neutral-300'} />
        ))}
      </span>
      <span className='text-xs text-neutral-500 tabular-nums'>{value.toFixed(1)}</span>
    </span>
  )
}

/** Thin progress track: green when the target is met, amber while short. */
export function ProgressTrack({ value, target }: { value: number; target: number }) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0
  const done = value >= target
  return (
    <div className='h-1.5 w-full rounded-full bg-neutral-100 overflow-hidden' aria-hidden='true'>
      <div className={`h-full rounded-full ${done ? 'bg-emerald-500' : 'bg-amber-400'}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export function partyName(party: PeerReviewParty | null | undefined, fallback: string): string {
  if (!party) return fallback
  const full = `${party.first_name || ''} ${party.last_name || ''}`.trim()
  return full || party.username || party.label || fallback
}

export function formatPct(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)}%` : '—'
}

/** One plain sentence per validation issue. */
export function issueMessage(t: TFunction, issue: Issue): string {
  const L = PEER_REVIEW_LIMITS
  switch (issue.code) {
    case 'criteria_min':
      return t('peer_review.instructor.errors.criteria_min')
    case 'criteria_max':
      return t('peer_review.instructor.errors.criteria_max', { max: L.criteriaMax })
    case 'criterion_title':
      return t('peer_review.instructor.errors.criterion_title')
    case 'levels_min':
      return t('peer_review.instructor.errors.levels_min', { min: L.levelsMin })
    case 'levels_max':
      return t('peer_review.instructor.errors.levels_max', { max: L.levelsMax })
    case 'level_label':
      return t('peer_review.instructor.errors.level_label')
    case 'level_points':
      return t('peer_review.instructor.errors.level_points')
    case 'prompts_min':
      return t('peer_review.instructor.errors.prompts_min')
    case 'prompts_max':
      return t('peer_review.instructor.errors.prompts_max', { max: L.promptsMax })
    case 'prompt_label':
      return t('peer_review.instructor.errors.prompt_label')
    case 'prompt_min_chars':
      return t('peer_review.instructor.errors.prompt_min_chars', { max: L.minCharsMax })
    case 'reviews_range':
    case 'min_reviews_range':
      return t('peer_review.instructor.errors.reviews_range', { min: L.reviewsMin, max: L.reviewsMax })
    case 'sample_title':
      return t('peer_review.instructor.errors.sample_title')
    case 'sample_content':
      return t('peer_review.instructor.errors.sample_content')
    case 'sample_levels':
      return t('peer_review.instructor.errors.sample_levels')
    default:
      // Duplicate ids/keys: the editor always mints fresh ones, so only stored data can trip this.
      return t('peer_review.instructor.errors.duplicate')
  }
}

export function FieldError({ children }: { children?: React.ReactNode }) {
  if (!children) return null
  return <p className='mt-1 text-xs font-medium text-rose-600'>{children}</p>
}
