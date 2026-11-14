'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  BookOpen,
  ChartBar,
  CheckCircle,
  Desktop,
  Eye,
  Globe,
  Lightning,
  LinkSimple,
  Pulse,
  Student,
} from '@phosphor-icons/react'
import { DashPage, EmptyState, Panel, SectionCard, SegmentedControl, Skeleton, StatCard, recipes } from '@/design'
import { getGlobalAnalytics } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import { useAccessToken, usePlatformMe, shouldRetry, useUrlFilters } from '@components/Admin/hooks'
import { AdminHeader, adminPath, CHART_COLORS, MiniBars, NoAccess, QueryError } from '@components/Admin/Shared/AdminKit'
import OnboardingFunnelCard from './OnboardingFunnelCard'

// Queries drawn with their own widgets; every other query falls back to a
// generic key/value card so new server queries still show up.
const KNOWN = new Set([
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
])

const rowsOf = (v: any): any[] => (Array.isArray(v?.data) ? v.data : [])

function TopList({
  rows,
  labelKey,
  valueKey,
  empty,
  fallbackLabel,
  format,
  color,
  capitalize = false,
}: {
  rows: any[]
  labelKey: string
  valueKey: string
  empty: string
  fallbackLabel: string
  /** Turns a raw key (e.g. an event name) into a label. */
  format?: (v: string) => string
  color: string
  capitalize?: boolean
}) {
  const max = Math.max(1, ...rows.map((r) => Number(r?.[valueKey]) || 0))
  if (!rows.length) return <p className="text-sm text-neutral-400">{empty}</p>
  return (
    <ul className="space-y-2.5">
      {rows.slice(0, 8).map((r, i) => {
        const v = Number(r?.[valueKey]) || 0
        return (
          <li key={i} className="space-y-1">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className={`truncate text-neutral-700 ${capitalize ? 'capitalize' : ''}`}>{(format ? format(String(r?.[labelKey] ?? '')) : r?.[labelKey]) || fallbackLabel}</span>
              <span className="tabular-nums font-semibold text-neutral-900">{v.toLocaleString()}</span>
            </div>
            <div className="h-1.5 rounded-full bg-neutral-100 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${(v / max) * 100}%`, background: color }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export default function AnalyticsPage() {
  const { t } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const [filters, setFilters] = useUrlFilters({ days: '30' })
  const days = [7, 30, 90].includes(Number(filters.days)) ? Number(filters.days) : 30

  const q = useQuery({
    queryKey: platformKeys.globalAnalytics(days),
    queryFn: () => getGlobalAnalytics(token, days),
    enabled: !!token && me.can('platform.read'),
    retry: shouldRetry,
    placeholderData: (prev) => prev,
  })

  if (!me.isLoading && !me.can('platform.read')) {
    return (
      <DashPage>
        <AdminHeader title={t('admin.pages.analytics')} />
        <NoAccess />
      </DashPage>
    )
  }

  const data = q.data ?? {}
  const loading = q.isLoading
  const live = rowsOf(data.live_users)[0]?.live_users
  const funnel = rowsOf(data.enrollment_funnel)[0] ?? {}
  const dau = rowsOf(data.daily_active_users)
  const n = (v: unknown) => (loading ? null : (Number(v) || 0).toLocaleString())
  const others = Object.entries(data).filter(([k, v]) => !KNOWN.has(k) && rowsOf(v).length > 0)
  const empty = !loading && !q.error && Object.values(data).every((v) => rowsOf(v).length === 0)

  return (
    <DashPage>
      <AdminHeader
        title={t('admin.pages.analytics')}
        subtitle={t('admin.pages.analytics_desc')}
        actions={
          <SegmentedControl
            ariaLabel={t('admin.analytics.period')}
            value={String(days)}
            onChange={(v) => setFilters({ days: v })}
            options={[7, 30, 90].map((d) => ({ key: String(d), label: t('admin.org_detail.days_short', { count: d }) }))}
          />
        }
      />

      <OnboardingFunnelCard days={days} />

      {q.error ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : empty ? (
        <Panel>
          <EmptyState icon={<ChartBar size={22} />} title={t('admin.analytics.no_data_available')} description={t('admin.analytics.empty_desc')} />
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <StatCard icon={<Pulse size={18} />} iconClass="bg-emerald-50 text-emerald-600" label={t('admin.org_detail.live_users')} value={n(live)} />
            <StatCard icon={<Eye size={18} />} iconClass="bg-sky-50 text-sky-600" label={t('admin.analytics.visitors')} value={n(funnel.page_views)} />
            <StatCard icon={<BookOpen size={18} />} iconClass="bg-amber-50 text-amber-600" label={t('admin.org_detail.course_views')} value={n(funnel.course_views)} />
            <StatCard icon={<Student size={18} />} iconClass="bg-rose-50 text-rose-600" label={t('admin.org_detail.enrollments')} value={n(funnel.enrollments)} />
            <StatCard icon={<CheckCircle size={18} />} iconClass="bg-violet-50 text-violet-600" label={t('admin.org_detail.completions')} value={n(funnel.completions)} />
          </div>

          <SectionCard icon={<Pulse size={18} />} title={t('admin.org_detail.daily_active_users')} description={t('admin.analytics.dau_desc', { count: days })}>
            {loading ? (
              <Skeleton className="h-24 w-full" />
            ) : dau.length ? (
              <>
                <MiniBars
                  label={t('admin.org_detail.daily_active_users')}
                  color={CHART_COLORS[0]}
                  data={dau.map((d: any) => ({ key: String(d.date), value: Number(d.dau) || 0, title: t('admin.org_detail.dau_tooltip', { date: d.date, count: Number(d.dau) || 0 }) }))}
                />
                <div className="mt-2 flex justify-between text-[11px] text-neutral-400">
                  <span>{dau[0]?.date}</span>
                  <span>{dau[dau.length - 1]?.date}</span>
                </div>
              </>
            ) : (
              <p className="text-sm text-neutral-400">{t('admin.analytics.no_data')}</p>
            )}
          </SectionCard>

          <div className={`${recipes.cardGrid.replace('xl:grid-cols-4', '')}`}>
            <SectionCard icon={<Globe size={18} />} title={t('admin.org_detail.top_countries')} description={t('admin.analytics.by_visits')}>
              {loading ? <Skeleton className="h-32 w-full" /> : <TopList rows={rowsOf(data.visitors_by_country)} color={CHART_COLORS[0]} labelKey="country_code" valueKey="visits" empty={t('admin.analytics.no_data')} fallbackLabel={t('common.unknown')} />}
            </SectionCard>
            <SectionCard icon={<Desktop size={18} />} title={t('admin.org_detail.devices')} description={t('admin.analytics.by_visits')}>
              {loading ? <Skeleton className="h-32 w-full" /> : <TopList rows={rowsOf(data.visitors_by_device)} color={CHART_COLORS[1]} capitalize labelKey="device_type" valueKey="visits" empty={t('admin.analytics.no_data')} fallbackLabel={t('common.unknown')} />}
            </SectionCard>
            <SectionCard icon={<LinkSimple size={18} />} title={t('admin.org_detail.top_referrers')} description={t('admin.analytics.by_visits')}>
              {loading ? <Skeleton className="h-32 w-full" /> : <TopList rows={rowsOf(data.visitors_by_referrer)} color={CHART_COLORS[2]} labelKey="referrer_domain" valueKey="visits" empty={t('admin.analytics.no_data')} fallbackLabel={t('admin.org_detail.direct')} />}
            </SectionCard>
            <SectionCard icon={<Lightning size={18} />} title={t('admin.org_detail.events')} description={t('admin.analytics.events_desc')}>
              {loading ? <Skeleton className="h-32 w-full" /> : <TopList
                  rows={rowsOf(data.event_counts)}
                  color={CHART_COLORS[3]}
                  labelKey="event_name"
                  valueKey="total"
                  empty={t('admin.analytics.no_data')}
                  fallbackLabel={t('common.unknown')}
                  format={(v) => t(`admin.analytics.event.${v}`, { defaultValue: v.replace(/_/g, ' ').replace(/^./, (ch) => ch.toUpperCase()) })}
                />}
            </SectionCard>
            <SectionCard icon={<BookOpen size={18} />} title={t('admin.org_detail.top_courses')} description={t('admin.analytics.courses_desc')}>
              {loading ? (
                <Skeleton className="h-32 w-full" />
              ) : rowsOf(data.top_courses).length ? (
                <ul className="divide-y divide-neutral-100">
                  {rowsOf(data.top_courses)
                    .slice(0, 6)
                    .map((c: any, i: number) => (
                      <li key={i} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0 text-xs">
                        {/* Name and org link when the API sends them; the uuid otherwise. */}
                        {c.course_name ? (
                          c.path || c.org_id ? (
                            <Link href={typeof c.path === 'string' && c.path.startsWith('/admin') ? c.path : adminPath.org(c.org_id, 'content')} className="truncate text-neutral-700 hover:underline underline-offset-2">
                              {c.course_name}
                              {c.org_name ? <span className="text-neutral-400"> · {c.org_name}</span> : null}
                            </Link>
                          ) : (
                            <span className="truncate text-neutral-700">{c.course_name}</span>
                          )
                        ) : (
                          <code className="truncate font-mono text-neutral-500" dir="ltr" title={String(c.course_uuid ?? '')}>
                            {String(c.course_uuid ?? '').replace(/^course_/, '').slice(0, 13)}
                          </code>
                        )}
                        <span className="shrink-0 text-neutral-600">
                          {t('admin.org_detail.views_count', { count: Number(c.views) || 0 })} · {t('admin.org_detail.enrolled_count', { count: Number(c.enrollments) || 0 })}
                        </span>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="text-sm text-neutral-400">{t('admin.analytics.no_data')}</p>
              )}
            </SectionCard>
            {others.map(([name, v]) => {
              const first = rowsOf(v)[0] ?? {}
              return (
                <SectionCard key={name} icon={<ChartBar size={18} />} title={name.replace(/_/g, ' ')} description={t('admin.analytics.other_desc')}>
                  <div className="divide-y divide-neutral-100">
                    {Object.entries(first).map(([k, val]) => (
                      <div key={k} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0 text-sm">
                        <span className="text-neutral-500 truncate">{k.replace(/_/g, ' ')}</span>
                        <span className="font-semibold text-neutral-900 tabular-nums">{typeof val === 'number' ? val.toLocaleString() : String(val)}</span>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              )
            })}
          </div>
        </>
      )}
    </DashPage>
  )
}
