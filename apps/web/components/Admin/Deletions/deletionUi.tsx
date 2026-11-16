'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { CaretDown, CheckCircle, Hourglass, Robot, ShieldCheck, ShieldWarning, User, XCircle } from '@phosphor-icons/react'
import { Chip, StatusPill, type Status } from '@/design'
import { getSignals, opsKeys, type OrgSignals } from '@services/ee/platform/ops'
import { shouldRetry, useAccessToken } from '@components/Admin/hooks'
import { adminPath } from '@components/Admin/Shared/AdminKit'

// Pieces the Deletions page, the org Signals card and the deletion dialogs
// share: the test-score pill, the countdown and the signals breakdown.

export function useSignals(orgId: string | number | null | undefined, enabled = true) {
  const token = useAccessToken()
  return useQuery({
    queryKey: opsKeys.signals(orgId ?? ''),
    queryFn: () => getSignals(token, orgId!),
    enabled: !!token && !!orgId && enabled,
    retry: shouldRetry,
    staleTime: 60_000,
  })
}

export function scoreStatus(score?: number | null): Status {
  if (score === null || score === undefined) return 'neutral'
  if (score >= 80) return 'danger'
  if (score >= 50) return 'warning'
  return 'neutral'
}

export function ScorePill({ score }: { score?: number | null }) {
  const { t } = useTranslation()
  if (score === null || score === undefined) return null
  return (
    <StatusPill status={scoreStatus(score)} title={t('admin.deletions.score_title')}>
      <span className="tabular-nums">{t('admin.deletions.score', { score })}</span>
    </StatusPill>
  )
}

/** Time left until a scheduled deletion: "2 days left" (amber), "5 hours left" / "due" (rose). */
export function Countdown({ at }: { at?: string | null }) {
  const { t } = useTranslation()
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  if (!at) return null
  const ms = new Date(at).getTime() - now
  if (isNaN(ms)) return null
  const hours = Math.max(0, Math.floor(ms / 3_600_000))
  const days = Math.floor(hours / 24)
  const label = ms <= 0 ? t('admin.deletions.due_now') : days >= 1 ? t('admin.deletions.days_left', { count: days }) : t('admin.deletions.hours_left', { count: Math.max(1, hours) })
  const tone = days >= 2 ? 'text-amber-600 bg-amber-50' : 'text-rose-600 bg-rose-50'
  return (
    <span className={`inline-flex items-center gap-1 h-6 px-2 rounded-full text-xs font-semibold tabular-nums whitespace-nowrap ${tone}`} title={new Date(at).toLocaleString()}>
      <Hourglass size={12} weight="fill" />
      {label}
    </span>
  )
}

/** Score bar 0–100 colored by band. */
export function ScoreBar({ score }: { score: number }) {
  const s = Math.max(0, Math.min(100, score))
  const color = s >= 80 ? 'bg-rose-500' : s >= 50 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="h-1.5 w-full rounded-full bg-neutral-100 overflow-hidden" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={s}>
      <div className={`h-full rounded-full ${color}`} style={{ width: `${s}%` }} />
    </div>
  )
}

/** Disposable / free / test chips for one admin address. */
export function AdminEmailChips({ admin }: { admin: OrgSignals['admins'][number] }) {
  const { t } = useTranslation()
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {admin.disposable && <Chip tone="rose">{t('admin.deletions.disposable')}</Chip>}
      {admin.abstract_disposable === true && !admin.disposable && <Chip tone="rose">{t('admin.deletions.abstract_disposable')}</Chip>}
      {admin.free_provider && <Chip tone="amber">{t('admin.deletions.free_provider')}</Chip>}
      {admin.looks_test && <Chip tone="amber">{t('admin.deletions.looks_test')}</Chip>}
      {!admin.disposable && !admin.free_provider && !admin.looks_test && admin.abstract_disposable !== true && <Chip tone="emerald">{t('admin.deletions.looks_real')}</Chip>}
    </span>
  )
}

/** Hard guards: "all pass" or the list of failures, collapsible. */
export function GuardsList({ guards, defaultOpen = false }: { guards?: OrgSignals['guards']; defaultOpen?: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(defaultOpen)
  if (!guards) return null
  const failures = Array.isArray(guards.failures) ? guards.failures : []
  if (guards.ok) {
    return (
      <p className="flex items-start gap-2 text-sm text-emerald-600">
        <ShieldCheck size={16} weight="fill" className="mt-px shrink-0" />
        {t('admin.deletions.guards_ok')}
      </p>
    )
  }
  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex items-center gap-2 text-sm text-neutral-700 hover:text-neutral-900">
        <ShieldWarning size={16} weight="fill" className="shrink-0 text-amber-600" />
        {t('admin.deletions.guards_blocked', { count: failures.length })}
        <CaretDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul className="mt-2 space-y-1 ps-6">
          {failures.map((f) => (
            <li key={f} className="flex items-start gap-1.5 text-xs text-neutral-600">
              <XCircle size={13} className="mt-px shrink-0 text-rose-600" />
              {f}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function ReasonList({ reasons }: { reasons?: string[] | null }) {
  const list = Array.isArray(reasons) ? reasons : []
  if (!list.length) return null
  return (
    <ul className="space-y-1">
      {list.map((r) => (
        <li key={r} className="flex items-start gap-1.5 text-xs text-neutral-600">
          <CheckCircle size={13} className="mt-px shrink-0 text-amber-600" />
          {r}
        </li>
      ))}
    </ul>
  )
}

/** "user:1" → link to the user; "automation:<uuid>" → link to the rule. */
export function RequestedBy({ value }: { value?: string | null }) {
  const { t } = useTranslation()
  if (!value) return <span className="text-neutral-400">–</span>
  const [kind, id] = value.split(':', 2)
  if (kind === 'user' && id)
    return (
      <Link href={adminPath.user(id)} className="inline-flex items-center gap-1 hover:underline underline-offset-2">
        <User size={12} />
        {t('admin.deletions.by_user', { id })}
      </Link>
    )
  if (kind === 'automation' && id)
    return (
      <Link href={adminPath.automation(id)} className="inline-flex items-center gap-1 hover:underline underline-offset-2">
        <Robot size={12} />
        {t('admin.deletions.by_automation')}
      </Link>
    )
  return <span>{value}</span>
}

