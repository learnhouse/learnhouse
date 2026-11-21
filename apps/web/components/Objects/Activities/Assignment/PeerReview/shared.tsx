'use client'
import React, { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Star } from '@phosphor-icons/react'

/** Step heading plus the one plain sentence on why the step matters. */
export function StepIntro({ title, why, aside }: { title: string; why: string; aside?: React.ReactNode }) {
  return (
    <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
      <div className='min-w-0'>
        <h4 className='text-base font-semibold leading-tight text-neutral-900'>{title}</h4>
        <p className='mt-1 text-sm text-neutral-500'>{why}</p>
      </div>
      {aside && <div className='flex flex-none flex-wrap items-center gap-2'>{aside}</div>}
    </div>
  )
}

/** A thin progress bar. */
export function ProgressBar({ pct, tone = 'teal', label }: { pct: number; tone?: 'teal' | 'emerald'; label: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)))
  return (
    <div
      role='progressbar'
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      className='h-1.5 w-full overflow-hidden rounded-full bg-neutral-100'
    >
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${tone === 'emerald' ? 'bg-emerald-500' : 'bg-teal-500'}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

/**
 * 1–5 helpfulness stars as a native radio group: Tab focuses the group,
 * arrow keys move between stars, Space picks.
 */
export function StarRating({
  value,
  onChange,
  disabled,
  label,
}: {
  value: number | null | undefined
  onChange: (_value: number) => void
  disabled?: boolean
  label: string
}) {
  const { t } = useTranslation()
  const name = useId()
  const current = Number(value) || 0
  return (
    <div role='radiogroup' aria-label={label} className='flex items-center gap-0.5'>
      {[1, 2, 3, 4, 5].map((n) => {
        const on = n <= current
        return (
          <label
            key={n}
            title={t('peer_review.learner.stars_n', { count: n })}
            className={`rounded-md p-0.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-amber-400 ${disabled ? 'cursor-default' : 'cursor-pointer hover:scale-110'} transition-transform`}
          >
            <input
              type='radio'
              name={name}
              value={n}
              checked={current === n}
              disabled={disabled}
              onChange={() => onChange(n)}
              className='sr-only'
              aria-label={t('peer_review.learner.stars_n', { count: n })}
            />
            <Star size={20} weight={on ? 'fill' : 'regular'} className={on ? 'text-amber-400' : 'text-neutral-300'} aria-hidden='true' />
          </label>
        )
      })}
    </div>
  )
}
