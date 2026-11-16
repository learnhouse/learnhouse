'use client'
// Limits & usage: each metered resource against the plan's limit, amber near
// the limit and rose at it. Also the AI credit balance card for the AI tab.
import React from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, EnvelopeSimple, Gauge, Lightning, ShieldCheck, UserCheck, Users } from '@phosphor-icons/react'
import { SectionCard, Skeleton } from '@/design'
import type { OrgUsageResponse } from '@services/orgs/usage'
import { meterLevel, meterPercent, type MeterLevel, type PlanOverview } from '@services/orgs/planOverview'

const U = 'dashboard.organization.usage'
const P = 'dashboard.organization.plan_usage.usage'

export interface AICreditsSummary {
  plan: string
  base_credits: number | string
  purchased_credits: number
  total_credits: number | string
  used_credits: number
  remaining_credits: number | string
  mode?: string | null
}

const BAR: Record<MeterLevel, string> = {
  ok: 'bg-neutral-900',
  near: 'bg-amber-500',
  full: 'bg-rose-500',
  unlimited: 'bg-neutral-300',
}

export interface Meter {
  id: string
  label: string
  icon: React.ReactNode
  usage: number
  limit: number | 'unlimited'
  note?: React.ReactNode
  // A billed dimension, not a quota (active members): going over is charged,
  // never blocked, so it is never shown as "limit reached".
  billed?: boolean
}

export function MeterTile({ meter }: { meter: Meter }) {
  const { t } = useTranslation()
  const raw = meterLevel(meter.usage, meter.limit)
  const level: MeterLevel = meter.billed && raw === 'full' ? 'near' : raw
  const over = meter.billed && raw === 'full'
  const unlimited = level === 'unlimited'
  const pct = meterPercent(meter.usage, meter.limit)
  return (
    <div className="rounded-xl ring-1 ring-inset ring-neutral-200/70 p-4 min-w-0" data-meter={meter.id} data-level={level}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-semibold text-neutral-500 min-w-0">
          <span className="text-neutral-400 shrink-0">{meter.icon}</span>
          <span className="truncate">{meter.label}</span>
        </span>
        {!unlimited && <span className="text-xs text-neutral-400 tabular-nums">{pct}%</span>}
      </div>
      <p className="mt-2 text-xl font-bold text-neutral-900 tabular-nums">
        {meter.usage.toLocaleString()}
        <span className="text-sm font-medium text-neutral-400">
          {' / '}
          {unlimited ? '∞' : (meter.limit as number).toLocaleString()}
        </span>
      </p>
      {/* No limit, no bar to fill: an empty track keeps the tiles aligned. */}
      <div className="mt-3 h-1.5 bg-neutral-100 rounded-full overflow-hidden">
        {!unlimited && <div className={`h-full rounded-full transition-all duration-500 ${BAR[level]}`} style={{ width: `${pct}%` }} />}
      </div>
      <p className={`text-xs mt-2 ${level === 'full' ? 'text-rose-600' : level === 'near' ? 'text-amber-700' : 'text-neutral-400'}`}>
        {over
          ? meter.note
          : level === 'full'
          ? t(`${U}.limit_reached`)
          : level === 'near'
            ? t(`${P}.near_limit`)
            : unlimited
              ? t(`${P}.no_limit`)
              : t(`${U}.remaining_count`, { count: Math.max(0, (meter.limit as number) - meter.usage) })}
      </p>
      {meter.note && !over && <p className="text-xs text-neutral-400 mt-1">{meter.note}</p>}
    </div>
  )
}

function asLimit(v: number | 'unlimited' | undefined | null): number | 'unlimited' {
  return typeof v === 'number' && v > 0 ? v : 'unlimited'
}

function asNumber(v: number | string | undefined | null): number | 'unlimited' {
  return typeof v === 'number' ? v : 'unlimited'
}

export function useMeters(
  usage: OrgUsageResponse | undefined,
  overview: PlanOverview | undefined,
  credits: AICreditsSummary | undefined
): Meter[] {
  const { t } = useTranslation()
  const f = usage?.features
  if (!f) return []
  const meters: Meter[] = [
    { id: 'members', label: t(`${U}.members_label`), icon: <Users size={15} />, usage: f.members.usage, limit: asLimit(f.members.limit) },
    { id: 'admin_seats', label: t(`${U}.admin_seats`), icon: <ShieldCheck size={15} />, usage: f.admin_seats.usage, limit: asLimit(f.admin_seats.limit) },
    { id: 'courses', label: t(`${U}.courses`), icon: <BookOpen size={15} />, usage: f.courses.usage, limit: asLimit(f.courses.limit) },
  ]
  if (f.active_members && usage?.mode === 'saas') {
    const over = f.active_members.overage_units ?? 0
    meters.push({
      id: 'active_members',
      label: t(`${P}.active_members`),
      icon: <UserCheck size={15} />,
      usage: f.active_members.usage,
      limit: asLimit(f.active_members.limit),
      billed: true,
      note: over > 0 ? t(`${P}.active_members_over`, { count: over }) : undefined,
    })
  }
  if (credits && credits.mode !== 'disabled') {
    meters.push({
      id: 'ai_credits',
      label: t(`${U}.ai_credits`),
      icon: <Lightning size={15} />,
      usage: credits.used_credits ?? 0,
      limit: asNumber(credits.total_credits),
    })
  }
  const nl = overview?.usage?.newsletter_emails
  if (nl) {
    meters.push({ id: 'newsletter_emails', label: t(`${P}.newsletter_emails`), icon: <EnvelopeSimple size={15} />, usage: nl.usage, limit: nl.limit })
  }
  return meters
}

export default function UsageMeters({ meters, loading }: { meters: Meter[]; loading: boolean }) {
  const { t } = useTranslation()
  return (
    <SectionCard icon={<Gauge size={18} />} title={t(`${P}.title`)} description={t(`${P}.desc`)}>
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : meters.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-6">{t(`${U}.unavailable`)}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="plan-usage-meters">
          {meters.map((m) => (
            <MeterTile key={m.id} meter={m} />
          ))}
        </div>
      )}
    </SectionCard>
  )
}

/** The AI credit balance in detail: base, purchased, used, remaining. */
export function AICreditsDetail({ credits }: { credits: AICreditsSummary }) {
  const { t } = useTranslation()
  const cell = (label: string, value: React.ReactNode) => (
    <div className="rounded-xl ring-1 ring-inset ring-neutral-200/70 px-4 py-3">
      <p className="text-xs text-neutral-400 mb-1">{label}</p>
      <p className="text-lg font-bold text-neutral-900 tabular-nums">{value}</p>
    </div>
  )
  const show = (v: number | string) => (v === 'unlimited' ? t(`${U}.unlimited`) : typeof v === 'number' ? v.toLocaleString() : v)
  return (
    <div className="flex flex-col gap-4">
      <MeterTile
        meter={{
          id: 'ai_credits_detail',
          label: t(`${U}.credit_usage`),
          icon: <Lightning size={15} weight="duotone" />,
          usage: credits.used_credits ?? 0,
          limit: asNumber(credits.total_credits),
        }}
      />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {cell(t(`${U}.base_credits`), show(credits.base_credits))}
        {cell(t(`${U}.purchased`), show(credits.purchased_credits))}
        {cell(t(`${U}.used`), show(credits.used_credits ?? 0))}
        {cell(t(`${U}.remaining`), show(credits.remaining_credits))}
      </div>
    </div>
  )
}
