'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, ChartBar, ChartLineUp, Gauge, Globe, Pulse, ShieldStar, Users } from '@phosphor-icons/react'
import { EmptyState, Panel, SectionCard, SegmentedControl, Skeleton, StatCard } from '@/design'
import { getOrgAnalytics, getOrgUsage } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import { useAccessToken, useUrlQuery, shouldRetry } from '@components/Admin/hooks'
import { CHART_INK, MiniBars, QueryError } from '@components/Admin/Shared/AdminKit'

function UsageMeter({ icon, label, usage, limit }: { icon: React.ReactNode; label: string; usage: number; limit: number | string }) {
  const { t } = useTranslation()
  const unlimited = limit === 'unlimited' || limit === 0
  const numLimit = typeof limit === 'number' ? limit : 0
  const pct = unlimited || numLimit <= 0 ? 0 : Math.min(100, (usage / numLimit) * 100)
  const bar = unlimited ? 'bg-sky-400/60' : pct >= 90 ? 'bg-rose-500' : pct >= 70 ? 'bg-amber-400' : 'bg-emerald-500'
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs text-neutral-500 min-w-0">
          <span className="text-neutral-400 shrink-0">{icon}</span>
          <span className="truncate">{label}</span>
        </span>
        <span className="text-xs text-neutral-400 tabular-nums shrink-0">
          {usage.toLocaleString()} / {unlimited ? t('admin.org_detail.unlimited') : numLimit.toLocaleString()}
        </span>
      </div>
      <p className="mt-1 text-xl font-bold text-neutral-900 tabular-nums">{usage.toLocaleString()}</p>
      <div className="mt-2 h-1.5 rounded-full bg-neutral-100 overflow-hidden">
        <div className={`h-full rounded-full ${bar}`} style={{ width: unlimited ? '15%' : `${Math.max(2, pct)}%` }} />
      </div>
      {!unlimited && pct >= 90 && <p className="mt-1.5 text-[11px] font-medium text-rose-600">{t('admin.org_detail.limit_almost_reached')}</p>}
    </div>
  )
}

function RankList({ title, icon, rows }: { title: string; icon: React.ReactNode; rows: { label: React.ReactNode; value: React.ReactNode; key: string }[] }) {
  if (!rows.length) return null
  return (
    <SectionCard icon={icon} title={title} bodyClassName="px-5 pb-5 pt-3">
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-neutral-600 truncate min-w-0">{r.label}</span>
            <span className="text-neutral-900 font-medium tabular-nums shrink-0">{r.value}</span>
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}

const CORE_KEYS = [
  'live_users',
  'enrollment_funnel',
  'event_counts',
  'daily_active_users',
  'top_courses',
  'visitors_by_country',
  'visitors_by_device',
  'visitors_by_referrer',
  'daily_visitor_breakdown',
  'activity_engagement',
]

/** Plan usage against limits (courses, members, admin seats). */
export function UsageMeters({ org, orgId }: { org: any; orgId: string }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const usageQ = useQuery({
    queryKey: platformKeys.orgUsage(orgId),
    queryFn: () => getOrgUsage(token, orgId),
    enabled: !!token,
    retry: shouldRetry,
  })
  const features = usageQ.data?.features
  return (
    <>
      <SectionCard icon={<Gauge size={18} />} title={t('admin.org.usage_title')} description={t('admin.org.usage_desc')} bodyClassName="p-5 pt-4">
        {usageQ.isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
        ) : features ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <UsageMeter icon={<BookOpen size={14} />} label={t('admin.org_detail.tabs.courses')} usage={features.courses?.usage ?? 0} limit={features.courses?.limit ?? 'unlimited'} />
            <UsageMeter icon={<Users size={14} />} label={t('admin.org_detail.members')} usage={features.members?.usage ?? 0} limit={features.members?.limit ?? 'unlimited'} />
            <UsageMeter icon={<ShieldStar size={14} />} label={t('admin.org_detail.admin_seats')} usage={features.admin_seats?.usage ?? 0} limit={features.admin_seats?.limit ?? 'unlimited'} />
          </div>
        ) : usageQ.error ? (
          <QueryError error={usageQ.error} compact onRetry={() => usageQ.refetch()} />
        ) : (
          <div className="grid grid-cols-2 gap-6">
            <UsageMeter icon={<Users size={14} />} label={t('admin.org_detail.members')} usage={org.user_count ?? 0} limit="unlimited" />
            <UsageMeter icon={<BookOpen size={14} />} label={t('admin.org_detail.tabs.courses')} usage={org.course_count ?? 0} limit="unlimited" />
          </div>
        )}
      </SectionCard>

    </>
  )
}

/** Visits, enrollments and engagement; the period lives in the URL (`a_days`). */
export function AnalyticsPanel({ orgId }: { orgId: string }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const [url, setUrl] = useUrlQuery()
  const days = (['7', '30', '90'].includes(url.a_days ?? '') ? url.a_days : '30') as '7' | '30' | '90'
  const setDays = (d: '7' | '30' | '90') => setUrl({ a_days: d === '30' ? undefined : d })
  const analyticsQ = useQuery({
    queryKey: platformKeys.orgAnalytics(orgId, Number(days)),
    queryFn: () => getOrgAnalytics(token, orgId, Number(days)),
    enabled: !!token,
    retry: shouldRetry,
    placeholderData: (prev) => prev,
  })
  const a = analyticsQ.data || {}
  const rows = (k: string): any[] => (Array.isArray(a?.[k]?.data) ? a[k].data : [])
  const liveUsers = rows('live_users')[0]?.live_users || 0
  const funnel = rows('enrollment_funnel')[0] || {}
  const dau = rows('daily_active_users')
  const hasAnalytics = Object.keys(a).some((k) => rows(k).length > 0)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-neutral-900">{t('common.analytics')}</h2>
          <p className="text-sm text-neutral-500">{t('admin.org.analytics_desc')}</p>
        </div>
        <SegmentedControl
          value={days}
          onChange={setDays}
          ariaLabel={t('admin.org_detail.period')}
          options={(['7', '30', '90'] as const).map((d) => ({ key: d, label: t('admin.org_detail.days_short', { count: Number(d) }) }))}
        />
      </div>

      {analyticsQ.isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[68px] rounded-2xl" />
          ))}
        </div>
      ) : analyticsQ.error ? (
        <QueryError error={analyticsQ.error} onRetry={() => analyticsQ.refetch()} />
      ) : !hasAnalytics ? (
        <Panel>
          <EmptyState icon={<ChartBar size={22} />} title={t('admin.org_detail.no_analytics')} description={t('admin.org.no_analytics_desc')} />
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <StatCard icon={<Pulse size={18} />} iconClass="bg-emerald-50 text-emerald-600" label={t('admin.org_detail.live_users')} value={liveUsers.toLocaleString()} />
            <StatCard icon={<Globe size={18} />} iconClass="bg-sky-50 text-sky-600" label={t('admin.org_detail.page_views')} value={(funnel.page_views || 0).toLocaleString()} />
            <StatCard icon={<BookOpen size={18} />} iconClass="bg-neutral-100 text-neutral-600" label={t('admin.org_detail.course_views')} value={(funnel.course_views || 0).toLocaleString()} />
            <StatCard icon={<Users size={18} />} iconClass="bg-amber-50 text-amber-600" label={t('admin.org_detail.enrollments')} value={(funnel.enrollments || 0).toLocaleString()} />
            <StatCard icon={<ChartLineUp size={18} />} iconClass="bg-rose-50 text-rose-600" label={t('admin.org_detail.completions')} value={(funnel.completions || 0).toLocaleString()} />
          </div>

          {dau.length > 0 && (
            <SectionCard icon={<ChartLineUp size={18} />} title={t('admin.org_detail.daily_active_users')} description={t('admin.org.dau_desc', { count: Number(days) })}>
              <MiniBars
                label={t('admin.org_detail.daily_active_users')}
                color={CHART_INK}
                data={dau.map((d: any, i: number) => ({
                  key: String(d.date ?? i),
                  value: d.dau || 0,
                  title: t('admin.org_detail.dau_tooltip', { date: d.date, count: d.dau || 0 }),
                }))}
              />
              <div className="mt-2 flex justify-between text-[11px] text-neutral-400 tabular-nums">
                <span>{dau[0]?.date}</span>
                <span>{dau[dau.length - 1]?.date}</span>
              </div>
            </SectionCard>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <RankList
              title={t('admin.org_detail.top_courses')}
              icon={<BookOpen size={18} />}
              rows={rows('top_courses')
                .slice(0, 5)
                .map((c: any, i: number) => ({
                  key: String(c.course_uuid ?? i),
                  label: <span className="font-mono text-xs" dir="ltr">{String(c.course_uuid ?? '').slice(0, 14)}…</span>,
                  value: `${t('admin.org_detail.views_count', { count: c.views || 0 })} · ${t('admin.org_detail.enrolled_count', { count: c.enrollments || 0 })}`,
                }))}
            />
            <RankList
              title={t('admin.org_detail.events')}
              icon={<Pulse size={18} />}
              rows={rows('event_counts')
                .slice(0, 8)
                .map((e: any, i: number) => ({ key: String(e.event_name ?? i), label: e.event_name, value: (e.total || 0).toLocaleString() }))}
            />
            <RankList
              title={t('admin.org_detail.top_countries')}
              icon={<Globe size={18} />}
              rows={rows('visitors_by_country')
                .slice(0, 8)
                .map((c: any, i: number) => ({ key: String(c.country_code ?? i), label: c.country_code || t('common.unknown'), value: (c.visits || 0).toLocaleString() }))}
            />
            <RankList
              title={t('admin.org_detail.devices')}
              icon={<Gauge size={18} />}
              rows={rows('visitors_by_device').map((d: any, i: number) => ({
                key: String(d.device_type ?? i),
                label: <span className="capitalize">{d.device_type || t('common.unknown')}</span>,
                value: (d.visits || 0).toLocaleString(),
              }))}
            />
            <RankList
              title={t('admin.org_detail.top_referrers')}
              icon={<ChartLineUp size={18} />}
              rows={rows('visitors_by_referrer')
                .slice(0, 8)
                .map((r: any, i: number) => ({ key: String(r.referrer_domain ?? i), label: r.referrer_domain || t('admin.org_detail.direct'), value: (r.visits || 0).toLocaleString() }))}
            />
            {/* Any other query the analytics service adds shows up generically. */}
            {Object.keys(a)
              .filter((k) => !CORE_KEYS.includes(k) && rows(k).length > 0)
              .map((k) => (
                <RankList
                  key={k}
                  title={k.replace(/_/g, ' ')}
                  icon={<ChartBar size={18} />}
                  rows={Object.entries(rows(k)[0] || {}).map(([key, val]) => ({
                    key,
                    label: key.replace(/_/g, ' '),
                    value: typeof val === 'number' ? val.toLocaleString() : String(val),
                  }))}
                />
              ))}
          </div>
        </>
      )}
    </div>
  )
}
