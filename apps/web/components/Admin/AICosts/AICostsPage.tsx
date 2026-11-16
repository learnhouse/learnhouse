'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ChartLineUp, Coins, CurrencyDollar, Gauge, Lightning, Tag, Warning } from '@phosphor-icons/react'
import { AIMark, DashPage, EmptyState, Panel, SectionCard, SegmentedControl, Skeleton, StatCard, StatusPill, ToolbarSelect } from '@/design'
import { getAICosts } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import type { AICostsOverview } from '@services/ee/platform/types'
import { useAccessToken, usePlatformMe, shouldRetry, useUrlFilters } from '@components/Admin/hooks'
import { AdminHeader, adminPath, NoAccess, QueryError } from '@components/Admin/Shared/AdminKit'
import { CostValueChart, MarginBadge, PriceCell, Td, Th, fillDays, num, usd } from './aiCostsKit'

const DAYS = [7, 30, 90]

/**
 * Platform console: what AI costs us (provider list price) against what the
 * credits we charged are worth, by feature, by organization and over time.
 * Prices, the credit value and the margin floor come from the API's pricing
 * module, never from this page.
 */
export default function AICostsPage() {
  const { t } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const [filters, setFilters] = useUrlFilters({ days: '30', feature: '' })
  const days = DAYS.includes(Number(filters.days)) ? Number(filters.days) : 30
  const feature = filters.feature || ''

  const q = useQuery({
    queryKey: platformKeys.aiCosts(days, feature),
    queryFn: () => getAICosts(token, days, feature || undefined),
    enabled: !!token && me.can('platform.read'),
    retry: shouldRetry,
    placeholderData: (prev) => prev,
  })

  if (!me.isLoading && !me.can('platform.read')) {
    return (
      <DashPage>
        <AdminHeader title={t('admin.pages.ai_costs')} />
        <NoAccess />
      </DashPage>
    )
  }

  const data = q.data
  const loading = q.isLoading
  const floor = data?.pricing.margin_floor ?? 2
  const featureOptions = [
    { value: '', label: t('admin.ai_costs.all_features') },
    ...(data?.pricing.features ?? []).map((f) => ({ value: f.key, label: f.label })),
  ]
  const belowFloor = (data?.by_feature ?? []).filter((f) => f.below_floor && !f.absorbed)

  return (
    <DashPage>
      <AdminHeader
        title={t('admin.pages.ai_costs')}
        subtitle={t('admin.pages.ai_costs_desc')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ToolbarSelect
              ariaLabel={t('admin.ai_costs.feature_filter')}
              icon={<Tag size={14} />}
              value={feature}
              onChange={(v) => setFilters({ feature: v })}
              options={featureOptions}
            />
            <SegmentedControl
              ariaLabel={t('admin.analytics.period')}
              value={String(days)}
              onChange={(v) => setFilters({ days: v })}
              options={DAYS.map((d) => ({ key: String(d), label: t('admin.org_detail.days_short', { count: d }) }))}
            />
          </div>
        }
      />

      {q.error ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard icon={<CurrencyDollar size={18} />} iconClass="bg-rose-50 text-rose-600" label={t('admin.ai_costs.provider_cost')} value={loading ? null : usd(data?.totals.cost_usd, 2)} />
            <StatCard icon={<Coins size={18} />} iconClass="bg-emerald-50 text-emerald-600" label={t('admin.ai_costs.credits_value')} value={loading ? null : usd(data?.totals.value_usd, 2)} />
            <StatCard
              icon={<Gauge size={18} />}
              iconClass="bg-violet-50 text-violet-600"
              label={t('admin.ai_costs.gross_margin')}
              value={loading ? null : data?.totals.gross_margin_pct == null ? '–' : `${data.totals.gross_margin_pct}%`}
            />
            <StatCard icon={<Lightning size={18} />} iconClass="bg-sky-50 text-sky-600" label={t('admin.ai_costs.requests')} value={loading ? null : num(data?.totals.requests)} />
          </div>

          {belowFloor.length > 0 && (
            <Panel className="p-4 flex items-start gap-3">
              <Warning size={18} className="text-rose-600 shrink-0 mt-0.5" />
              <p className="text-sm text-neutral-700">
                {t('admin.ai_costs.below_floor_banner', { count: belowFloor.length, floor, features: belowFloor.map((f) => f.label).join(', ') })}
              </p>
            </Panel>
          )}

          <SectionCard icon={<ChartLineUp size={18} />} title={t('admin.ai_costs.over_time')} description={t('admin.ai_costs.over_time_desc', { count: days })}>
            {loading ? <Skeleton className="h-32 w-full" /> : <CostValueChart days={fillDays(data?.from, data?.to, data?.by_day ?? [])} />}
          </SectionCard>

          <FeatureTable data={data} loading={loading} floor={floor} />
          <OrgTable data={data} loading={loading} floor={floor} />
          <UnmeteredCard data={data} loading={loading} />
          <PricingPanel data={data} loading={loading} />
        </>
      )}
    </DashPage>
  )
}

function FeatureTable({ data, loading, floor }: { data?: AICostsOverview; loading: boolean; floor: number }) {
  const { t } = useTranslation()
  const rows = data?.by_feature ?? []
  return (
    <SectionCard icon={<AIMark size={18} alt="" />} title={t('admin.ai_costs.by_feature')} description={t('admin.ai_costs.by_feature_desc', { floor })} bodyClassName="p-0 pt-4">
      {loading ? (
        <div className="p-5"><Skeleton className="h-32 w-full" /></div>
      ) : !rows.length ? (
        <EmptyState icon={<AIMark size={22} alt="" />} title={t('admin.ai_costs.no_usage')} description={t('admin.ai_costs.no_usage_desc')} />
      ) : (
        <div className="overflow-x-auto scrollbar-hide">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-y border-neutral-100 text-xs text-neutral-500">
                <Th>{t('admin.ai_costs.feature')}</Th>
                <Th end>{t('admin.ai_costs.published_price')}</Th>
                <Th end>{t('admin.ai_costs.requests')}</Th>
                <Th end>{t('admin.ai_costs.credits')}</Th>
                <Th end>{t('admin.ai_costs.cost')}</Th>
                <Th end>{t('admin.ai_costs.value')}</Th>
                <Th end>{t('admin.ai_costs.margin')}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map((r) => (
                <tr key={r.feature} className="hover:bg-neutral-50/70">
                  <Td>
                    <span className="block text-[13px] text-neutral-800">{r.label}</span>
                    <code className="text-[11px] text-neutral-400" dir="ltr">{r.feature}</code>
                  </Td>
                  <Td end><PriceCell credits={r.published_credits} metered={r.metered} absorbed={r.absorbed} /></Td>
                  <Td end>{num(r.requests)}</Td>
                  <Td end>{num(r.credits)}</Td>
                  <Td end>{usd(r.cost_usd)}</Td>
                  <Td end>{usd(r.value_usd)}</Td>
                  <Td end>
                    <span className="inline-flex items-center gap-1.5">
                      <MarginBadge row={r} floor={floor} />
                      {r.below_floor ? <StatusPill status="danger">{t('admin.ai_costs.below_floor')}</StatusPill> : null}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
}

function OrgTable({ data, loading, floor }: { data?: AICostsOverview; loading: boolean; floor: number }) {
  const { t } = useTranslation()
  const rows = data?.by_org ?? []
  if (!loading && !rows.length) return null
  return (
    <SectionCard icon={<Coins size={18} />} title={t('admin.ai_costs.by_org')} description={t('admin.ai_costs.by_org_desc')} bodyClassName="p-0 pt-4">
      {loading ? (
        <div className="p-5"><Skeleton className="h-32 w-full" /></div>
      ) : (
        <div className="overflow-x-auto scrollbar-hide">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-y border-neutral-100 text-xs text-neutral-500">
                <Th>{t('admin.ai_costs.organization')}</Th>
                <Th end>{t('admin.ai_costs.requests')}</Th>
                <Th end>{t('admin.ai_costs.credits')}</Th>
                <Th end>{t('admin.ai_costs.cost')}</Th>
                <Th end>{t('admin.ai_costs.value')}</Th>
                <Th end>{t('admin.ai_costs.margin')}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map((r) => (
                <tr key={r.org_id} className="hover:bg-neutral-50/70">
                  <Td>
                    <Link href={adminPath.org(r.org_id, 'plan')} className="text-[13px] text-neutral-800 hover:underline underline-offset-2">
                      {r.org_name || t('admin.ai_costs.org_fallback', { id: r.org_id })}
                    </Link>
                  </Td>
                  <Td end>{num(r.requests)}</Td>
                  <Td end>{num(r.credits)}</Td>
                  <Td end>{usd(r.cost_usd)}</Td>
                  <Td end>{usd(r.value_usd)}</Td>
                  <Td end><MarginBadge row={r} floor={floor} /></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
}

function UnmeteredCard({ data, loading }: { data?: AICostsOverview; loading: boolean }) {
  const { t } = useTranslation()
  const rows = (data?.unmetered ?? []).filter((r) => r.calls > 0)
  return (
    <SectionCard icon={<Warning size={18} />} title={t('admin.ai_costs.unmetered')} description={t('admin.ai_costs.unmetered_desc')}>
      {loading ? (
        <Skeleton className="h-12 w-full" />
      ) : !rows.length ? (
        <p className="text-sm text-neutral-500">{t('admin.ai_costs.unmetered_none')}</p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {rows.map((r) => (
            <li key={r.model} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0 text-sm">
              <code className="text-neutral-700" dir="ltr">{r.model}</code>
              <span className="text-neutral-600 tabular-nums">
                {t('admin.ai_costs.unmetered_row', { count: r.calls, cost: usd(r.cost_usd) })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

function PricingPanel({ data, loading }: { data?: AICostsOverview; loading: boolean }) {
  const { t } = useTranslation()
  const p = data?.pricing
  return (
    <SectionCard icon={<Tag size={18} />} title={t('admin.ai_costs.pricing')} description={t('admin.ai_costs.pricing_desc')} bodyClassName="p-0 pt-4">
      {loading || !p ? (
        <div className="p-5"><Skeleton className="h-32 w-full" /></div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 px-5 pb-4">
            <div>
              <p className="text-xs text-neutral-500">{t('admin.ai_costs.credit_value')}</p>
              <p className="text-lg font-semibold text-neutral-900 tabular-nums">{usd(p.credit_value_usd, 4)}</p>
              <p className="text-[11px] text-neutral-400">{p.credit_value_source}</p>
            </div>
            <div>
              <p className="text-xs text-neutral-500">{t('admin.ai_costs.margin_floor')}</p>
              <p className="text-lg font-semibold text-neutral-900 tabular-nums">{p.margin_floor}×</p>
              <p className="text-[11px] text-neutral-400">{t('admin.ai_costs.margin_floor_hint', { pct: Math.round((1 - 1 / p.margin_floor) * 100) })}</p>
            </div>
            <div>
              <p className="text-xs text-neutral-500">{t('admin.ai_costs.prices_as_of')}</p>
              <p className="text-lg font-semibold text-neutral-900">{p.prices_as_of}</p>
              <p className="text-[11px] text-neutral-400 break-all" dir="ltr">{p.price_source}</p>
            </div>
          </div>

          <div className="overflow-x-auto scrollbar-hide">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-y border-neutral-100 text-xs text-neutral-500">
                  <Th>{t('admin.ai_costs.feature')}</Th>
                  <Th end>{t('admin.ai_costs.published_price')}</Th>
                  <Th>{t('admin.ai_costs.unit')}</Th>
                  <Th end>{t('admin.ai_costs.value')}</Th>
                  <Th end>{t('admin.ai_costs.p90_cost')}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {p.features.map((f) => (
                  <tr key={f.key} className="hover:bg-neutral-50/70">
                    <Td><span className="text-[13px] text-neutral-800">{f.label}</span></Td>
                    <Td end><PriceCell credits={f.credits} metered={f.metered} absorbed={f.absorbed} /></Td>
                    <Td className="text-neutral-600">{f.unit}</Td>
                    <Td end>{usd(f.value_usd)}</Td>
                    <Td end>{f.p90_cost_usd ? usd(f.p90_cost_usd) : '–'}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h4 className="px-5 pt-6 pb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('admin.ai_costs.model_prices')}</h4>
          <div className="overflow-x-auto scrollbar-hide pb-2">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-y border-neutral-100 text-xs text-neutral-500">
                  <Th>{t('admin.ai_costs.model')}</Th>
                  <Th end>{t('admin.ai_costs.input_per_m')}</Th>
                  <Th end>{t('admin.ai_costs.output_per_m')}</Th>
                  <Th end>{t('admin.ai_costs.media_out_per_m')}</Th>
                  <Th end>{t('admin.ai_costs.planning_price')}</Th>
                  <Th>{t('admin.ai_costs.source')}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {p.models.map((m) => {
                  const media = m.image_output_per_m ?? m.audio_output_per_m
                  const changes = m.planning_input_per_m !== m.input_per_m || m.planning_output_per_m !== m.output_per_m
                  return (
                    <tr key={m.model} className="hover:bg-neutral-50/70">
                      <Td><code className="text-[12px] text-neutral-800" dir="ltr">{m.model}</code></Td>
                      <Td end>{usd(m.input_per_m, 2)}</Td>
                      <Td end>{usd(m.output_per_m, 2)}</Td>
                      <Td end>{media == null ? '–' : usd(media, 2)}</Td>
                      <Td end>{changes ? `${usd(m.planning_input_per_m, 2)} / ${usd(m.planning_output_per_m, 2)}` : '–'}</Td>
                      <Td className="text-[11px] text-neutral-400 max-w-[260px] truncate">
                        <span title={m.source}>{m.source}</span>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </SectionCard>
  )
}
