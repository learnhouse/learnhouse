'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Coins } from '@phosphor-icons/react'
import { SectionCard, SegmentedControl, Skeleton } from '@/design'
import { getOrgAICosts } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import { useAccessToken, usePlatformMe, shouldRetry } from '@components/Admin/hooks'
import { QueryError, adminPath } from '@components/Admin/Shared/AdminKit'
import { CostValueChart, MarginBadge, Td, Th, fillDays, num, usd } from '@components/Admin/AICosts/aiCostsKit'

const DAYS = [7, 30, 90]

/** An organization's AI costs (provider cost vs credits charged) for the org detail Plan tab. */
export default function AICostsCard({ orgId }: { orgId: string }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const [days, setDays] = React.useState(30)
  const q = useQuery({
    queryKey: platformKeys.orgAiCosts(orgId, days),
    queryFn: () => getOrgAICosts(token, orgId, days),
    enabled: !!token && me.can('platform.read'),
    retry: shouldRetry,
    placeholderData: (prev) => prev,
  })
  if (!me.isLoading && !me.can('platform.read')) return null
  const data = q.data
  const totals = data?.totals
  const floor = data?.margin_floor ?? 2

  return (
    <SectionCard
      icon={<Coins size={18} />}
      title={t('admin.ai_costs.org_title')}
      description={t('admin.ai_costs.org_desc')}
      actions={
        <SegmentedControl
          ariaLabel={t('admin.analytics.period')}
          value={String(days)}
          onChange={(v) => setDays(Number(v))}
          options={DAYS.map((d) => ({ key: String(d), label: t('admin.org_detail.days_short', { count: d }) }))}
        />
      }
      bodyClassName="p-0 pt-4"
    >
      {q.error ? (
        <div className="p-5"><QueryError compact error={q.error} onRetry={() => q.refetch()} /></div>
      ) : q.isLoading || !data || !totals ? (
        <div className="p-5"><Skeleton className="h-28 w-full" /></div>
      ) : (
        <>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 px-5 pb-4">
            <Stat label={t('admin.ai_costs.provider_cost')} value={usd(totals.cost_usd)} />
            <Stat label={t('admin.ai_costs.credits_value')} value={usd(totals.value_usd)} />
            <Stat label={t('admin.ai_costs.credits')} value={num(totals.credits)} />
            <div>
              <dt className="text-xs text-neutral-500">{t('admin.ai_costs.margin')}</dt>
              <dd className="mt-1"><MarginBadge row={totals} floor={floor} /></dd>
            </div>
          </dl>
          <div className="px-5 pb-4">
            <CostValueChart days={fillDays(data.from, data.to, data.by_day)} height={80} />
          </div>
          {data.by_feature.length > 0 && (
            <div className="overflow-x-auto scrollbar-hide">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-y border-neutral-100 text-xs text-neutral-500">
                    <Th>{t('admin.ai_costs.feature')}</Th>
                    <Th end>{t('admin.ai_costs.requests')}</Th>
                    <Th end>{t('admin.ai_costs.credits')}</Th>
                    <Th end>{t('admin.ai_costs.cost')}</Th>
                    <Th end>{t('admin.ai_costs.margin')}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {data.by_feature.map((r) => (
                    <tr key={r.feature}>
                      <Td className="text-[13px] text-neutral-800">{r.label}</Td>
                      <Td end>{num(r.requests)}</Td>
                      <Td end>{num(r.credits)}</Td>
                      <Td end>{usd(r.cost_usd)}</Td>
                      <Td end><MarginBadge row={r} floor={floor} /></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.by_member.length > 0 && (
            <div className="px-5 py-4">
              <p className="text-xs font-medium text-neutral-500 mb-2">{t('admin.ai_costs.top_members')}</p>
              <ul className="flex flex-wrap gap-2">
                {data.by_member.map((m) => {
                  const name = [m.first_name, m.last_name].filter(Boolean).join(' ') || m.username || t('admin.ai_costs.system_member')
                  const label = `${name} · ${t('admin.ai_costs.credits_count', { count: m.credits })}`
                  return (
                    <li key={m.user_id ?? 'system'} className="text-xs rounded-full border border-neutral-200 px-2.5 py-1 text-neutral-700">
                      {m.user_id ? <Link href={adminPath.user(m.user_id)} className="hover:underline underline-offset-2">{label}</Link> : label}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
          <div className="px-5 pb-4 text-xs">
            <Link href="/admin/ai-costs" className="text-neutral-500 hover:text-neutral-800 underline-offset-2 hover:underline">
              {t('admin.ai_costs.see_all')}
            </Link>
          </div>
        </>
      )}
    </SectionCard>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="mt-1 text-base font-semibold text-neutral-900 tabular-nums">{value}</dd>
    </div>
  )
}
