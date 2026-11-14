'use client'
// AI credits on the usage page: where the credits went (by day, by feature,
// by member) and what each AI feature costs (the published price table).
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartBar, Tag, UsersThree } from '@phosphor-icons/react'
import { SectionCard, SegmentedControl } from '@components/Dashboard/Shared/DashKit/DashKit'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { tokens } from '@/design'
import { useAICreditPrices } from '@components/Hooks/useAICredits'
import { CreditsIcon } from '@components/Objects/AI/CreditCost'
import { getAIUsage, type AIFeaturePrice, type AIUsageReport } from '@services/ai/credits'

const PERIODS = ['7', '30', '90'] as const
type Period = (typeof PERIODS)[number]

const GROUP_ORDER = ['atlas', 'content', 'media', 'learners']

function fillDays(report: AIUsageReport | undefined, days: number) {
  const byDate = new Map((report?.by_day || []).map((d) => [d.date, d.credits]))
  const out: { date: string; label: string; credits: number }[] = []
  const end = new Date()
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - i))
    const key = d.toISOString().slice(0, 10)
    out.push({ date: key, label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), credits: byDate.get(key) || 0 })
  }
  return out
}

function memberName(m: AIUsageReport['by_member'][number], fallback: string): string {
  const full = [m.first_name, m.last_name].filter(Boolean).join(' ').trim()
  return full || m.username || fallback
}

export function AICreditsUsageBreakdown({ orgId }: { orgId: number }) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const [period, setPeriod] = useState<Period>('30')
  const days = Number(period)
  const { data, isLoading, isError } = useQuery<AIUsageReport>({
    queryKey: ['org', orgId, 'ai-credits-usage', days],
    queryFn: () => getAIUsage(orgId, days, token),
    enabled: !!(token && orgId),
    staleTime: 60_000,
  })
  const series = useMemo(() => fillDays(data, days), [data, days])
  const maxFeature = Math.max(1, ...(data?.by_feature || []).map((f) => f.credits))
  const axis = tokens.color['chart-axis'].hex
  const grid = tokens.color['chart-grid'].hex
  const bar = tokens.color['chart-1'].hex

  return (
    <SectionCard
      icon={<ChartBar size={18} />}
      title={t('ai_credits.usage.title', { defaultValue: 'AI credit usage' })}
      description={t('ai_credits.usage.description', { defaultValue: 'Where your credits went, by day, feature and member.' })}
      actions={
        <SegmentedControl<Period>
          value={period}
          onChange={setPeriod}
          ariaLabel={t('ai_credits.usage.period', { defaultValue: 'Period' })}
          options={PERIODS.map((p) => ({ key: p, label: t('ai_credits.usage.days', { count: Number(p), defaultValue: '{{count}} days' }) }))}
        />
      }
    >
      {isLoading ? (
        <div className="h-56 rounded-xl bg-neutral-50 animate-pulse" />
      ) : isError ? (
        <p className="text-sm text-neutral-400 text-center py-6">{t('ai_credits.usage.unavailable', { defaultValue: 'Usage is not available right now.' })}</p>
      ) : (
        <div className="flex flex-col gap-6" data-testid="ai-usage-breakdown">
          <div>
            <p className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-neutral-900 tabular-nums">{(data?.total_credits ?? 0).toLocaleString()}</span>
              <span className="text-sm text-neutral-500">
                {t('ai_credits.usage.total', {
                  count: data?.total_requests ?? 0,
                  days,
                  defaultValue: 'credits used in {{days}} days, over {{count}} requests',
                })}
              </span>
            </p>
            <div className="mt-3 h-48" aria-label={t('ai_credits.usage.by_day', { defaultValue: 'Credits per day' })}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: axis }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: axis }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip
                    cursor={{ fill: 'rgba(0,0,0,0.03)' }}
                    formatter={(v: any) => [t('ai_credits.count', { count: Number(v), defaultValue: '{{count}} credits' }), '']}
                    labelStyle={{ fontSize: 12, color: '#171717' }}
                    contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid #e5e5e5' }}
                    separator=""
                  />
                  <Bar dataKey="credits" fill={bar} radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="min-w-0">
              <h4 className="flex items-center gap-1.5 text-xs font-semibold text-neutral-500 mb-2">
                <Tag size={13} /> {t('ai_credits.usage.by_feature', { defaultValue: 'By feature' })}
              </h4>
              {(data?.by_feature || []).length === 0 ? (
                <p className="text-sm text-neutral-400 py-3">{t('ai_credits.usage.none', { defaultValue: 'No AI credits used in this period.' })}</p>
              ) : (
                <ul className="rounded-xl ring-1 ring-inset ring-neutral-200/70 divide-y divide-neutral-100">
                  {data!.by_feature.map((f) => (
                    <li key={f.feature} className="px-4 py-2.5">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="truncate text-neutral-800">{t(`ai_credits.features.${f.feature}`, { defaultValue: f.label })}</span>
                        <span className="flex-none tabular-nums font-semibold text-neutral-900">{f.credits.toLocaleString()}</span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-1 flex-1 rounded-full bg-neutral-100 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${(f.credits / maxFeature) * 100}%`, background: bar }} />
                        </div>
                        <span className="text-[11px] text-neutral-400 tabular-nums">
                          {t('ai_credits.usage.requests', { count: f.requests, defaultValue: '{{count}} requests' })}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="min-w-0">
              <h4 className="flex items-center gap-1.5 text-xs font-semibold text-neutral-500 mb-2">
                <UsersThree size={13} /> {t('ai_credits.usage.by_member', { defaultValue: 'By member' })}
              </h4>
              {(data?.by_member || []).length === 0 ? (
                <p className="text-sm text-neutral-400 py-3">{t('ai_credits.usage.none', { defaultValue: 'No AI credits used in this period.' })}</p>
              ) : (
                <ul className="rounded-xl ring-1 ring-inset ring-neutral-200/70 divide-y divide-neutral-100">
                  {data!.by_member.slice(0, 20).map((m) => {
                    const name = memberName(m, t('ai_credits.usage.system', { defaultValue: 'Automations' }))
                    return (
                      <li key={m.user_id ?? 'system'} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                        <span className="w-7 h-7 flex-none rounded-full bg-neutral-100 text-neutral-500 text-[11px] font-semibold flex items-center justify-center uppercase">
                          {name.slice(0, 2)}
                        </span>
                        <span className="flex-1 min-w-0 truncate text-neutral-800" dir="auto">{name}</span>
                        <span className="text-[11px] text-neutral-400 tabular-nums">
                          {t('ai_credits.usage.requests', { count: m.requests, defaultValue: '{{count}} requests' })}
                        </span>
                        <span className="w-14 text-end tabular-nums font-semibold text-neutral-900">{m.credits.toLocaleString()}</span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  )
}

export function priceText(t: (_k: string, _o?: any) => string, fp: AIFeaturePrice): string {
  if (fp.absorbed) return t('ai_credits.prices.included', { defaultValue: 'Included' })
  const unit = t(`ai_credits.units.${fp.unit}`, { defaultValue: fp.unit })
  const amount = t('ai_credits.count', { count: fp.credits, defaultValue: '{{count}} credits' })
  const base = fp.metered
    ? t('ai_credits.prices.metered', { amount, unit, defaultValue: 'From {{amount}} per {{unit}}' })
    : t('ai_credits.prices.flat', { amount, unit, defaultValue: '{{amount}} per {{unit}}' })
  if (fp.metered && (fp.typical ?? 0) > fp.credits) {
    return `${base} · ${t('ai_credits.prices.typical', { count: fp.typical, defaultValue: 'usually about {{count}}' })}`
  }
  return base
}

export function AICreditPriceTable() {
  const { t } = useTranslation()
  const { prices, isLoading } = useAICreditPrices()
  const groups = useMemo(() => {
    const by = new Map<string, AIFeaturePrice[]>()
    for (const f of prices?.features || []) {
      if (!by.has(f.group)) by.set(f.group, [])
      by.get(f.group)!.push(f)
    }
    return [...by.entries()].sort((a, b) => GROUP_ORDER.indexOf(a[0]) - GROUP_ORDER.indexOf(b[0]))
  }, [prices])

  return (
    <SectionCard
      icon={<CreditsIcon size={16} />}
      title={t('ai_credits.prices.title', { defaultValue: 'What AI features cost' })}
      description={t('ai_credits.prices.description', {
        defaultValue:
          'Credits each AI feature uses. "From" prices are a minimum: long or heavy requests (many Atlas steps, long audio) use credits for what they actually do.',
      })}
    >
      {isLoading ? (
        <div className="h-40 rounded-xl bg-neutral-50 animate-pulse" />
      ) : (
        <div className="grid gap-5 md:grid-cols-2" data-testid="ai-price-table">
          {groups.map(([group, rows]) => (
            <div key={group} className="min-w-0">
              <h4 className="text-xs font-semibold text-neutral-500 mb-2">
                {t(`ai_credits.groups.${group}`, { defaultValue: group })}
              </h4>
              <ul className="rounded-xl ring-1 ring-inset ring-neutral-200/70 divide-y divide-neutral-100">
                {rows.map((f) => (
                  <li key={f.key} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                    <span className="min-w-0 truncate text-neutral-800">{t(`ai_credits.features.${f.key}`, { defaultValue: f.label })}</span>
                    <span className="flex-none inline-flex items-center gap-1 text-neutral-600 tabular-nums text-[13px]">
                      {!f.absorbed && <CreditsIcon size={11} />}
                      {priceText(t, f)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}
