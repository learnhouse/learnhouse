'use client'
import React from 'react'
import { ArrowCounterClockwise } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import { cn } from '@/lib/utils'
import { Stars } from './Stars'

export interface ExperienceFooterProps {
  stars?: 0 | 1 | 2 | 3
  /** Already formatted ("7 / 9", "320 pts"). */
  score?: string
  progress?: { done: number; total: number }
  onRetry?: () => void
  /** Label for the retry button; defaults to "Try again". */
  retryLabel?: string
  children?: React.ReactNode
  className?: string
}

/** Score, progress and "Try again" row at the bottom of an experience. */
export function ExperienceFooter({ stars, score, progress, onRetry, retryLabel, children, className }: ExperienceFooterProps) {
  const { t } = useTranslation()
  const pct = progress && progress.total > 0 ? Math.round((Math.min(progress.done, progress.total) / progress.total) * 100) : 0
  return (
    <div className={cn('lh-exp-footer flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-neutral-100 px-4 py-3 sm:px-5', className)}>
      {progress && progress.total > 0 && (
        <div className="flex min-w-[8rem] flex-1 items-center gap-2.5">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={Math.min(progress.done, progress.total)}
            aria-label={t('activities.experiences.common.progress_label', 'Progress')}
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100"
          >
            <div className="lh-exp-progress-fill h-full rounded-full bg-neutral-900" style={{ width: `${pct}%` }} />
          </div>
          <span className="shrink-0 text-xs font-medium tabular-nums text-neutral-500">
            {t('activities.experiences.common.progress', {
              done: Math.min(progress.done, progress.total),
              total: progress.total,
              defaultValue: '{{done}} of {{total}}',
            })}
          </span>
        </div>
      )}
      {(stars !== undefined || score) && (
        <div className="flex items-center gap-2">
          {stars !== undefined && <Stars value={stars} />}
          {score && (
            <span className="text-sm font-semibold tabular-nums text-neutral-800">
              <span className="sr-only">{t('activities.experiences.common.score', 'Score')}: </span>
              {score}
            </span>
          )}
        </div>
      )}
      {children}
      {onRetry && (
        <button type="button" onClick={onRetry} className={buttonClass('secondary', 'sm', 'ms-auto')}>
          <ArrowCounterClockwise size={14} weight="bold" aria-hidden />
          {retryLabel ?? t('activities.experiences.common.try_again', 'Try again')}
        </button>
      )}
    </div>
  )
}

export default ExperienceFooter
