'use client'
import React from 'react'
import { Star } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export interface StarsProps {
  value: 0 | 1 | 2 | 3
  size?: number
  className?: string
}

/** Three stars; filled ones in amber. Announced as "2 of 3 stars". */
export function Stars({ value, size = 18, className }: StarsProps) {
  const { t } = useTranslation()
  const v = Math.max(0, Math.min(3, Math.round(value))) as 0 | 1 | 2 | 3
  return (
    <span
      role="img"
      aria-label={t('activities.experiences.common.stars_label', { value: v, defaultValue: 'Stars: {{value}} of 3' })}
      className={cn('lh-exp-stars inline-flex items-center gap-0.5', className)}
      data-value={v}
    >
      {[0, 1, 2].map((i) => (
        <Star
          key={i}
          size={size}
          weight={i < v ? 'fill' : 'regular'}
          aria-hidden
          className={cn('lh-exp-star', i < v ? 'text-amber-400' : 'text-neutral-300')}
          style={{ animationDelay: `${i * 90}ms` }}
          data-on={i < v ? 'true' : undefined}
        />
      ))}
    </span>
  )
}

export default Stars
