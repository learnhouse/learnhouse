'use client'

import React from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarClock, Hourglass, Link2, ListChecks, PlayCircle, TimerOff } from 'lucide-react'
import { DripLockReason, timeUntil } from '@/lib/drip'

type DripInfo = {
  drip_reason?: DripLockReason | string | null
  drip_unlock_at?: string | null
  drip_closes_at?: string | null
}

/**
 * Plain-language status for content held back by a course's drip schedule:
 * "Opens Mon, Nov 9 · in 5 days", "Opens when you start the course",
 * "Opens after you finish the previous chapter".
 */
export function useDripLabel() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language || 'en'

  return (info: DripInfo): { label: string; detail: string | null } => {
    if (info.drip_reason === 'enrollment') {
      return { label: t('course.drip.opens_on_enroll', 'Opens when you start the course'), detail: null }
    }
    if (info.drip_reason === 'previous') {
      return { label: t('course.drip.opens_after_previous', 'Opens after the previous chapter'), detail: null }
    }
    if (info.drip_reason === 'prerequisites') {
      return { label: t('course.drip.opens_after_required', 'Opens after the required chapters'), detail: null }
    }
    if (info.drip_reason === 'closed') {
      const closed = info.drip_closes_at ? new Date(info.drip_closes_at) : null
      return {
        label: t('course.drip.closed', 'No longer available'),
        detail: closed
          ? t('course.drip.closed_on', {
              defaultValue: 'closed {{date}}',
              date: closed.toLocaleDateString(locale, { month: 'short', day: 'numeric' }),
            })
          : null,
      }
    }
    if (info.drip_unlock_at) {
      const date = new Date(info.drip_unlock_at)
      const { days, hours } = timeUntil(date)
      const when = date.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' })
      const detail =
        days > 0
          ? t('course.drip.in_days', { defaultValue: 'in {{count}} days', count: days })
          : hours > 0
            ? t('course.drip.in_hours', { defaultValue: 'in {{count}} hours', count: hours })
            : t('course.drip.soon', 'in less than an hour')
      return { label: t('course.drip.opens_on', { defaultValue: 'Opens {{date}}', date: when }), detail }
    }
    return { label: t('course.drip.coming_soon', 'Coming soon'), detail: null }
  }
}

export function DripIcon({ reason, size = 12 }: { reason?: string | null; size?: number }) {
  if (reason === 'previous') return <Link2 size={size} />
  if (reason === 'enrollment') return <PlayCircle size={size} />
  if (reason === 'prerequisites') return <ListChecks size={size} />
  if (reason === 'closed') return <TimerOff size={size} />
  return <CalendarClock size={size} />
}

/** "Open until Nov 20": an open chapter that the schedule closes again later. */
export function DripUntilBadge({ closesAt, className }: { closesAt: string; className?: string }) {
  const { t, i18n } = useTranslation()
  const date = new Date(closesAt).toLocaleDateString(i18n.language || 'en', { month: 'short', day: 'numeric' })
  return (
    <span
      data-testid="drip-until-badge"
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-50 border border-sky-200 text-sky-700 text-[10px] font-semibold whitespace-nowrap ${className || ''}`}
    >
      <Hourglass size={10} />
      {t('course.drip.open_until', { defaultValue: 'Open until {{date}}', date })}
    </span>
  )
}

export default function DripBadge(props: DripInfo & { className?: string }) {
  const label = useDripLabel()(props)
  return (
    <span
      data-testid="drip-badge"
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-semibold whitespace-nowrap ${props.className || ''}`}
    >
      <DripIcon reason={props.drip_reason} size={10} />
      {label.label}
      {label.detail && <span className="font-normal text-amber-600/80">· {label.detail}</span>}
    </span>
  )
}
