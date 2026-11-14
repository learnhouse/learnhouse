'use client'
import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  Buildings,
  CaretRight,
  ChartPie,
  ClockCounterClockwise,
  CreditCard,
  Handshake,
  Heartbeat,
  Hourglass,
  Pulse,
  TrendUp,
  UserPlus,
  Users,
  WarningCircle,
  FlowArrow,
} from '@phosphor-icons/react'
import {
  DashPage,
  SectionCard,
  SegmentedControl,
  Skeleton,
  StatCard,
  ToolbarSelect,
  formatRelative,
} from '@/design'
import { getOverview, listAutomations } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import type { Overview } from '@services/ee/platform/types'
import { useAccessToken, usePlatformMe, useUrlFilters, shouldRetry } from '@components/Admin/hooks'
import {
  AdminHeader,
  CHART_COLORS,
  adminPath,
  orgDisplayName,
  HealthBadge,
  MiniBars,
  PLAN_COLORS,
  NoAccess,
  OrgLogo,
  PlanChip,
  QueryError,
  ShareBar,
  daysUntil,
} from '@components/Admin/Shared/AdminKit'
import { AuditEventList } from '@components/Admin/Shared/AuditEventList'
import { AutomationIcon } from '@components/Admin/Automations/automationVisuals'
import MyTasksCard from '@components/Admin/Tasks/MyTasksCard'


export default function OverviewPage() {
  const { t } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const [{ days }, setFilters] = useUrlFilters({ days: '30' })
  const range = Number(days) || 30

  const q = useQuery({
    queryKey: platformKeys.overview(range),
    queryFn: () => getOverview(token, range),
    enabled: !!token && me.can('platform.read'),
    retry: shouldRetry,
    placeholderData: (prev) => prev,
  })

  if (!me.isLoading && !me.can('platform.read')) {
    return (
      <DashPage>
        <AdminHeader title={t('admin.nav.overview')} />
        <NoAccess />
      </DashPage>
    )
  }

  const data = q.data
  return (
    <DashPage>
      <AdminHeader
        title={t('admin.overview.title')}
        subtitle={t('admin.overview.subtitle')}
        actions={
          <ToolbarSelect
            ariaLabel={t('admin.overview.range')}
            value={days}
            onChange={(v) => setFilters({ days: v })}
            options={[7, 30, 90].map((d) => ({ value: String(d), label: t('admin.overview.last_days', { count: d }) }))}
          />
        }
      />
      {q.error && !data ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <Kpis data={data} range={range} />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:items-start">
            <SignupsCard data={data} range={range} />
            <PlanMixCard data={data} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            <MyTasksCard data={(data as { my_tasks?: React.ComponentProps<typeof MyTasksCard>['data'] } | undefined)?.my_tasks} loading={!data} />
            <PocsEndingCard data={data} />
            <AtRiskCard data={data} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            <RecentActivityCard data={data} canAudit={me.can('audit.read')} />
            <FailuresCard data={data} canSee={me.canAny('automations.run', 'automations.manage')} />
          </div>
        </>
      )}
    </DashPage>
  )
}

function Kpis({ data, range }: { data?: Overview; range: number }) {
  const { t } = useTranslation()
  const router = useRouter()
  const k = data?.kpis
  const v = (n?: number) => (k ? (n ?? 0).toLocaleString() : null)
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatCard icon={<Buildings size={18} />} iconClass="bg-sky-50 text-sky-600" label={t('admin.overview.kpi.orgs_total')} value={v(k?.orgs_total)} onClick={() => router.push('/admin/organizations')} />
      <StatCard icon={<TrendUp size={18} />} iconClass="bg-sky-50 text-sky-600" label={t('admin.overview.kpi.orgs_new', { count: range })} value={v(k?.orgs_new)} onClick={() => router.push(`/admin/organizations?created_since=${range}d`)} />
      <StatCard icon={<Users size={18} />} iconClass="bg-emerald-50 text-emerald-600" label={t('admin.overview.kpi.users_total')} value={v(k?.users_total)} onClick={() => router.push('/admin/users')} />
      <StatCard icon={<UserPlus size={18} />} iconClass="bg-emerald-50 text-emerald-600" label={t('admin.overview.kpi.users_new', { count: range })} value={v(k?.users_new)} onClick={() => router.push(`/admin/users?created_since=${range}d`)} />
      <StatCard icon={<Pulse size={18} />} iconClass="bg-sky-50 text-sky-600" label={t('admin.overview.kpi.active_orgs_7d')} value={v(k?.active_orgs_7d)} onClick={() => router.push('/admin/organizations?sort=activity:desc')} />
      <StatCard icon={<CreditCard size={18} />} iconClass="bg-amber-50 text-amber-600" label={t('admin.overview.kpi.paid_orgs')} value={v(k?.paid_orgs)} onClick={() => router.push('/admin/organizations?plan=paid')} />
      <StatCard icon={<Handshake size={18} />} iconClass="bg-violet-50 text-violet-600" label={t('admin.overview.kpi.pocs_active')} value={v(k?.pocs_active)} onClick={() => router.push('/admin/pocs?status=active')} />
      <StatCard icon={<Hourglass size={18} />} iconClass="bg-rose-50 text-rose-600" label={t('admin.overview.kpi.pocs_ending_7d')} value={v(k?.pocs_ending_7d)} onClick={() => router.push('/admin/pocs?status=ending')} />
    </div>
  )
}

function SignupsCard({ data, range }: { data?: Overview; range: number }) {
  const { t, i18n } = useTranslation()
  const [series, setSeries] = React.useState<'users' | 'orgs'>('users')
  const rows = Array.isArray(data?.signups_series) ? data!.signups_series : []
  const total = rows.reduce((a, r) => a + (series === 'users' ? r.users || 0 : r.orgs || 0), 0)
  const fmt = (d: string) => {
    const date = new Date(d)
    return isNaN(date.getTime()) ? d : new Intl.DateTimeFormat(i18n.language, { month: 'short', day: 'numeric' }).format(date)
  }
  return (
    <SectionCard
      className="lg:col-span-2 min-w-0"
      icon={<TrendUp size={18} />}
      title={t('admin.overview.signups.title')}
      description={t('admin.overview.signups.description', { count: range })}
      actions={
        <SegmentedControl
          value={series}
          onChange={setSeries}
          ariaLabel={t('admin.overview.signups.title')}
          options={[
            { key: 'users', label: t('admin.overview.signups.users') },
            { key: 'orgs', label: t('admin.overview.signups.orgs') },
          ]}
        />
      }
    >
      {!data ? (
        <Skeleton className="h-32 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-neutral-400 py-10 text-center">{t('admin.overview.no_data')}</p>
      ) : (
        <div>
          <p className="text-2xl font-bold tabular-nums text-neutral-900">{total.toLocaleString()}</p>
          <div className="mt-3">
            <MiniBars
              height={120}
              label={t('admin.overview.signups.title')}
              color={series === 'users' ? CHART_COLORS[1] : CHART_COLORS[0]}
              data={rows.map((r) => {
                const value = series === 'users' ? r.users || 0 : r.orgs || 0
                // Each bar opens the accounts created that day.
                const day = r.date.slice(0, 10)
                const href = series === 'users' ? `/admin/users?created_since=${day}&created_until=${day}` : `/admin/organizations?created_since=${day}&created_until=${day}`
                return { key: r.date, value, title: `${fmt(r.date)}: ${value}`, href }
              })}
            />
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-neutral-400">
            <span>{fmt(rows[0].date)}</span>
            <span>{fmt(rows[rows.length - 1].date)}</span>
          </div>
        </div>
      )}
    </SectionCard>
  )
}

function PlanMixCard({ data }: { data?: Overview }) {
  const { t } = useTranslation()
  const parts = (Array.isArray(data?.plan_distribution) ? data!.plan_distribution : []).map((p) => ({
    key: p.plan,
    value: p.count,
    color: PLAN_COLORS[p.plan] ?? CHART_COLORS[6],
    href: `/admin/organizations?plan=${encodeURIComponent(p.plan)}`,
    label: t(`admin.plans.${p.plan}`, { defaultValue: p.plan }),
  }))
  return (
    <SectionCard icon={<ChartPie size={18} />} title={t('admin.overview.plan_mix.title')} description={t('admin.overview.plan_mix.description')} className="min-w-0">
      {!data ? <Skeleton className="h-24 w-full" /> : parts.length === 0 ? <p className="text-sm text-neutral-400">{t('admin.overview.no_data')}</p> : <ShareBar parts={parts} />}
    </SectionCard>
  )
}

function ListLoading() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-8 w-8" />
          <Skeleton className="h-4 flex-1" />
        </div>
      ))}
    </div>
  )
}

function OrgRow({ org, children }: { org: { id: number; name: string; slug: string; org_uuid: string; logo_image?: string | null; plan?: string }; children?: React.ReactNode }) {
  const { t } = useTranslation()
  return (
    <Link href={`/admin/organizations/${org.id}`} className="group flex items-center gap-3 py-2.5 first:pt-0 last:pb-0 min-w-0">
      <OrgLogo org={org} size={32} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-neutral-900 group-hover:underline underline-offset-2">{orgDisplayName(org, t)}</span>
        <span className="block truncate text-xs text-neutral-400" dir="ltr">
          {org.slug}
        </span>
      </span>
      {children}
      <CaretRight size={14} className="shrink-0 text-neutral-300 rtl:rotate-180" />
    </Link>
  )
}

function PocsEndingCard({ data }: { data?: Overview }) {
  const { t } = useTranslation()
  const rows = Array.isArray(data?.pocs_ending) ? data!.pocs_ending : []
  return (
    <SectionCard
      icon={<Handshake size={18} />}
      title={t('admin.overview.pocs_ending.title')}
      description={t('admin.overview.pocs_ending.description')}
      actions={
        <Link href="/admin/pocs" className="text-xs font-semibold text-neutral-500 hover:text-neutral-900">
          {t('admin.overview.view_all')}
        </Link>
      }
    >
      {!data ? (
        <ListLoading />
      ) : rows.length === 0 ? (
        <EmptyInline icon={<Handshake size={18} />} text={t('admin.overview.pocs_ending.empty')} />
      ) : (
        <div className="divide-y divide-neutral-100">
          {rows.map((o) => {
            const left = daysUntil(o.poc_ends_at)
            return (
              <OrgRow key={o.id} org={o}>
                <span className={`text-xs font-semibold tabular-nums whitespace-nowrap ${left !== null && left < 0 ? 'text-rose-600' : 'text-amber-700'}`}>
                  {left === null ? '–' : left < 0 ? t('admin.overview.overdue', { count: -left }) : t('admin.overview.days_left', { count: left })}
                </span>
              </OrgRow>
            )
          })}
        </div>
      )}
    </SectionCard>
  )
}

function AtRiskCard({ data }: { data?: Overview }) {
  const { t } = useTranslation()
  const rows = Array.isArray(data?.at_risk) ? data!.at_risk : []
  return (
    <SectionCard
      icon={<Heartbeat size={18} />}
      title={t('admin.overview.at_risk.title')}
      description={t('admin.overview.at_risk.description')}
      actions={
        <Link href="/admin/organizations?plan=paid&health_max=39&sort=health:asc" className="text-xs font-semibold text-neutral-500 hover:text-neutral-900">
          {t('admin.overview.view_all')}
        </Link>
      }
    >
      {!data ? (
        <ListLoading />
      ) : rows.length === 0 ? (
        <EmptyInline icon={<Heartbeat size={18} />} text={t('admin.overview.at_risk.empty')} />
      ) : (
        <div className="divide-y divide-neutral-100">
          {rows.map((o) => (
            <OrgRow key={o.id} org={o}>
              <PlanChip plan={o.plan} />
              <HealthBadge score={o.health_score} />
            </OrgRow>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

function RecentActivityCard({ data, canAudit }: { data?: Overview; canAudit: boolean }) {
  const { t } = useTranslation()
  const rows = Array.isArray(data?.recent_activity) ? data!.recent_activity : []
  return (
    <SectionCard
      className="lg:col-span-2 min-w-0"
      icon={<ClockCounterClockwise size={18} />}
      title={t('admin.overview.activity.title')}
      description={t('admin.overview.activity.description')}
      bodyClassName="py-3"
      actions={
        canAudit ? (
          <Link href="/admin/activity" className="text-xs font-semibold text-neutral-500 hover:text-neutral-900">
            {t('admin.overview.view_all')}
          </Link>
        ) : undefined
      }
    >
      {!data ? (
        <div className="px-5">
          <ListLoading />
        </div>
      ) : rows.length === 0 ? (
        <div className="px-5">
          <EmptyInline icon={<ClockCounterClockwise size={18} />} text={t('admin.overview.activity.empty')} />
        </div>
      ) : (
        <AuditEventList events={rows.slice(0, 8)} bare />
      )}
    </SectionCard>
  )
}

function FailuresCard({ data, canSee }: { data?: Overview; canSee: boolean }) {
  const { t, i18n } = useTranslation()
  const token = useAccessToken()
  const rows = Array.isArray(data?.automation_failures) ? data!.automation_failures : []
  // Runs carry no template: read it from the (shared, cached) rules list for the icon.
  const rules = useQuery({
    queryKey: platformKeys.automations(),
    queryFn: () => listAutomations(token),
    enabled: !!token && canSee && rows.length > 0,
    retry: shouldRetry,
  })
  const byUuid = new Map((Array.isArray(rules.data) ? rules.data : []).map((a) => [a.automation_uuid, a]))
  return (
    <SectionCard
      className="min-w-0"
      icon={<FlowArrow size={18} />}
      title={t('admin.overview.failures.title')}
      description={t('admin.overview.failures.description')}
      actions={
        canSee ? (
          <Link href="/admin/automations" className="text-xs font-semibold text-neutral-500 hover:text-neutral-900">
            {t('admin.overview.view_all')}
          </Link>
        ) : undefined
      }
    >
      {!data ? (
        <ListLoading />
      ) : rows.length === 0 ? (
        <EmptyInline icon={<FlowArrow size={18} />} text={t('admin.overview.failures.empty')} />
      ) : (
        <div className="divide-y divide-neutral-100">
          {rows.map((r) => {
            const href = r.automation_uuid ? adminPath.automation(r.automation_uuid, r.id) : '/admin/automations'
            return (
              <Link key={r.id} href={href} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0 group">
                <span className="relative mt-0.5 shrink-0">
                  <AutomationIcon automation={r.automation_uuid ? byUuid.get(r.automation_uuid) : null} />
                  {/* The failure itself stays visible as a rose badge on the rule's icon. */}
                  <span className="absolute -bottom-1 -end-1 h-4 w-4 rounded-full bg-white flex items-center justify-center">
                    <WarningCircle size={14} weight="fill" className="text-rose-600" />
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-neutral-900 group-hover:underline underline-offset-2">
                    {r.automation_name || t('admin.overview.failures.unnamed')}
                  </span>
                  <span className="block truncate text-xs text-neutral-400">
                    {r.error || t(`admin.overview.failures.status_${r.status}`, { defaultValue: r.status })} · {formatRelative(r.started_at, i18n.language) ?? '–'}
                  </span>
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </SectionCard>
  )
}

function EmptyInline({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    // Plain text, not a box inside the card.
    <p className="flex items-center gap-2.5 py-2 text-sm text-neutral-400">
      <span className="shrink-0">{icon}</span>
      {text}
    </p>
  )
}
