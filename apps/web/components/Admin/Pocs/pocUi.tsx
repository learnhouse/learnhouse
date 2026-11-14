'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Clock, Hourglass, Trophy, XCircle } from '@phosphor-icons/react'
import { StatusPill } from '@/design'
import { daysUntil, formatDate } from '@components/Admin/Shared/AdminKit'

// Small POC pieces shared by the POCs board and the org page.

export const ENDING_WINDOW_DAYS = 7

/** Won emerald, lost rose, expired amber. */
export function PocOutcomeChip({ outcome }: { outcome?: string | null }) {
  const { t } = useTranslation()
  if (!outcome) return null
  const status = outcome === 'won' ? 'success' : outcome === 'lost' ? 'danger' : 'warning'
  const icon = outcome === 'won' ? <Trophy size={12} weight="fill" /> : outcome === 'lost' ? <XCircle size={12} weight="fill" /> : <Hourglass size={12} weight="fill" />
  return (
    <StatusPill status={status} icon={icon}>
      {t(`admin.pocs.outcome_${outcome}`, { defaultValue: outcome })}
    </StatusPill>
  )
}

export function PocDaysLeft({ endsAt }: { endsAt?: string | null }) {
  const { t } = useTranslation()
  const left = daysUntil(endsAt)
  if (left === null) return null
  if (left < 0)
    return (
      <StatusPill status="danger" icon={<Hourglass size={12} />}>
        {t('admin.pocs.overdue', { count: -left })}
      </StatusPill>
    )
  return (
    <StatusPill status={left <= ENDING_WINDOW_DAYS ? 'warning' : 'info'} icon={<Clock size={12} />}>
      {t('admin.pocs.days_left', { count: left })}
    </StatusPill>
  )
}

/** Days used out of the POC's length, as a bar with start and end dates. */
export function PocProgress({ startedAt, endsAt }: { startedAt?: string | null; endsAt?: string | null }) {
  const { t, i18n } = useTranslation()
  if (!startedAt || !endsAt) return null
  const start = new Date(startedAt).getTime()
  const end = new Date(endsAt).getTime()
  if (isNaN(start) || isNaN(end) || end <= start) return null
  const total = Math.max(1, Math.round((end - start) / 86_400_000))
  // "Day 1" is the day it started, so the count never shows 0.
  const used = Math.min(total, Math.max(1, Math.ceil((Date.now() - start) / 86_400_000)))
  const pct = Math.min(100, (used / total) * 100)
  const left = daysUntil(endsAt) ?? 0
  const bar = left < 0 ? 'bg-rose-500' : left <= ENDING_WINDOW_DAYS ? 'bg-amber-500' : 'bg-violet-500'
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="font-semibold text-neutral-900 tabular-nums">{t('admin.pocs.progress_days', { used, total })}</span>
        <PocDaysLeft endsAt={endsAt} />
      </div>
      <div className="h-2 rounded-full bg-neutral-100 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={used}>
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.max(3, pct)}%` }} />
      </div>
      <div className="flex justify-between text-[11px] text-neutral-400 tabular-nums">
        <span>{formatDate(startedAt, i18n.language)}</span>
        <span>{formatDate(endsAt, i18n.language)}</span>
      </div>
    </div>
  )
}
