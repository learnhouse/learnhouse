'use client'
import React, { useMemo, useState } from 'react'
import { useAnalyticsPipe } from './useAnalyticsDashboard'
import {
  AnalyticsDetailModal,
  LiveUsersDetail,
  SignupsDetail,
  EnrollmentsDetail,
  CompletionsDetail,
} from './StatDetailModals'
import {
  Broadcast,
  UserPlus,
  GraduationCap,
  CheckCircle,
  FileText,
  ArrowsOutSimple,
  GlobeHemisphereWest,
  DeviceMobile,
  Desktop,
  Devices,
  LinkSimple,
} from '@phosphor-icons/react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import { useTranslation } from 'react-i18next'

const EVENT_META: Record<
  string,
  { labelKey: string; icon: React.ReactNode; dotColor: string; modalKey?: string }
> = {
  user_signed_up: {
    labelKey: 'analytics.overview.signups',
    icon: <UserPlus size={16} weight="duotone" className="text-blue-400" />,
    dotColor: 'bg-blue-400',
    modalKey: 'signups',
  },
  course_enrolled: {
    labelKey: 'analytics.overview.enrollments',
    icon: <GraduationCap size={16} weight="duotone" className="text-indigo-400" />,
    dotColor: 'bg-indigo-400',
    modalKey: 'enrollments',
  },
  course_completed: {
    labelKey: 'analytics.overview.completions',
    icon: <CheckCircle size={16} weight="duotone" className="text-green-400" />,
    dotColor: 'bg-green-400',
    modalKey: 'completions',
  },
  assignment_submitted: {
    labelKey: 'analytics.overview.submissions',
    icon: <FileText size={16} weight="duotone" className="text-amber-400" />,
    dotColor: 'bg-amber-400',
  },
}

function ChartTooltip({ active, payload, label, breakdownMap, t }: any) {
  if (!active || !payload?.length) return null
  const date = new Date(label)
  const formatted = date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  const dateKey = label
  const bd = breakdownMap?.[dateKey]

  return (
    <div className="bg-white nice-shadow rounded-xl px-4 py-3 text-sm min-w-[200px]">
      <p className="text-gray-500 text-xs mb-2">{formatted}</p>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2 h-2 rounded-full bg-blue-400" />
        <span className="text-gray-700 font-medium">{t('analytics.overview.active_users')}</span>
        <span className="text-gray-900 font-bold ml-auto">
          {payload[0].value.toLocaleString()}
        </span>
      </div>

      {bd && (
        <>
          <div className="border-t border-gray-100 pt-2 mt-1 space-y-1.5">
            <div className="flex items-center gap-2 text-[11px]">
              <Desktop size={11} className="text-blue-400" />
              <span className="text-gray-500">{t('analytics.overview.desktop')}</span>
              <span className="text-gray-700 font-medium ml-auto">{(bd.desktop ?? 0).toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              <DeviceMobile size={11} className="text-indigo-400" />
              <span className="text-gray-500">{t('analytics.overview.mobile')}</span>
              <span className="text-gray-700 font-medium ml-auto">{(bd.mobile ?? 0).toLocaleString()}</span>
            </div>
            {(bd.tablet ?? 0) > 0 && (
              <div className="flex items-center gap-2 text-[11px]">
                <Devices size={11} className="text-purple-400" />
                <span className="text-gray-500">{t('analytics.overview.tablet')}</span>
                <span className="text-gray-700 font-medium ml-auto">{bd.tablet.toLocaleString()}</span>
              </div>
            )}
          </div>

          {bd.top_countries?.length > 0 && bd.top_countries.some((c: string) => c) && (
            <div className="border-t border-gray-100 pt-2 mt-2">
              <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mb-1">
                <GlobeHemisphereWest size={10} />
                <span>{t('analytics.overview.top_countries')}</span>
              </div>
              <div className="flex gap-1.5">
                {bd.top_countries.filter((c: string) => c).map((code: string, i: number) => (
                  <span key={i} className="text-[11px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-mono">
                    {code}
                  </span>
                ))}
              </div>
            </div>
          )}

          {bd.top_referrer?.length > 0 && bd.top_referrer[0] && (
            <div className="border-t border-gray-100 pt-2 mt-2">
              <div className="flex items-center gap-1.5 text-[11px]">
                <LinkSimple size={10} className="text-green-400" />
                <span className="text-gray-400">{t('analytics.overview.top_referrer')}</span>
                <span className="text-gray-600 font-medium ml-auto truncate max-w-[120px]">
                  {bd.top_referrer[0]}
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

const DEVICE_COLORS: Record<string, string> = {
  desktop: '#6b8de3',
  mobile: '#818cf8',
  tablet: '#a78bfa',
  unknown: '#d1d5db',
}

const DEVICE_ICONS: Record<string, React.ReactNode> = {
  desktop: <Desktop size={13} weight="duotone" className="text-blue-400" />,
  mobile: <DeviceMobile size={13} weight="duotone" className="text-indigo-400" />,
  tablet: <Devices size={13} weight="duotone" className="text-purple-400" />,
  unknown: <Devices size={13} weight="duotone" className="text-gray-400" />,
}

export default function EventOverview({ days = '30' }: { days?: string }) {
  const { t } = useTranslation()
  const { data, isLoading } = useAnalyticsPipe('event_counts', { days })
  const { data: liveData, isLoading: liveLoading } = useAnalyticsPipe(
    'live_users',
    {},
    120000
  )
  const { data: dauData, isLoading: dauLoading } = useAnalyticsPipe(
    'daily_active_users',
    { days }
  )
  const { data: breakdownData } = useAnalyticsPipe(
    'daily_visitor_breakdown',
    { days }
  )
  const { data: countryData, isLoading: countryLoading } = useAnalyticsPipe(
    'visitors_by_country',
    { days }
  )
  const { data: deviceData, isLoading: deviceLoading } = useAnalyticsPipe(
    'visitors_by_device',
    { days }
  )
  const { data: referrerData, isLoading: referrerLoading } = useAnalyticsPipe(
    'visitors_by_referrer',
    { days }
  )

  const [activeModal, setActiveModal] = useState<string | null>(null)

  const rows: any[] = data?.data ?? []
  const liveCount = liveData?.data?.[0]?.live_users ?? 0
  const dauRows = dauData?.data ?? []
  const countryRows: any[] = countryData?.data ?? []
  const deviceRows: any[] = deviceData?.data ?? []
  const referrerRows: any[] = referrerData?.data ?? []

  const breakdownMap = useMemo(() => {
    const map: Record<string, any> = {}
    for (const row of breakdownData?.data ?? []) {
      map[row.date] = row
    }
    return map
  }, [breakdownData])

  const cards = Object.entries(EVENT_META).map(([event, meta]) => {
    const row = rows.find((r) => r.event_name === event)
    return { ...meta, label: t(meta.labelKey), total: row?.total ?? 0, unique: row?.unique_users ?? 0 }
  })

  const devicePieData = deviceRows.map((r: any) => ({
    name: r.device_type,
    value: r.visits,
    fill: DEVICE_COLORS[r.device_type] || DEVICE_COLORS.unknown,
  }))
  const totalDeviceVisits = devicePieData.reduce((s: number, d: any) => s + d.value, 0)

  return (
    <>
    <div className="bg-white nice-shadow rounded-xl overflow-hidden">
      <div className="grid grid-cols-5 divide-x divide-gray-100">
        <div
          className="px-5 py-4 cursor-pointer hover:bg-gray-50 transition-colors group relative"
          onClick={() => setActiveModal('live')}
        >
          <ArrowsOutSimple size={14} className="absolute top-3 right-3 text-gray-300 transition-opacity" />
          <div className="flex items-center gap-1.5 mb-1">
            <Broadcast size={14} weight="fill" className="text-green-500" />
            <span className="text-xs font-medium text-gray-400">{t('analytics.overview.live_now')}</span>
          </div>
          <div className="text-2xl font-bold text-gray-900">
            {liveLoading ? '—' : liveCount.toLocaleString()}
          </div>
          <p className="text-[11px] text-gray-300 mt-0.5">{t('analytics.overview.last_5_minutes')}</p>
        </div>
        {cards.map((card) => {
          return (
            <div
              key={card.labelKey}
              className={`px-5 py-4 ${card.modalKey ? 'cursor-pointer hover:bg-gray-50 transition-colors group relative' : ''}`}
              onClick={card.modalKey ? () => setActiveModal(card.modalKey!) : undefined}
            >
              {card.modalKey && <ArrowsOutSimple size={14} className="absolute top-3 right-3 text-gray-300 transition-opacity" />}
              <div className="flex items-center gap-1.5 mb-1">
                {card.icon}
                <span className="text-xs font-medium text-gray-400">
                  {card.label}
                </span>
              </div>
              <div className="text-2xl font-bold text-gray-900">
                {isLoading ? '—' : card.total.toLocaleString()}
              </div>
              <p className="text-[11px] text-gray-300 mt-0.5">
                {isLoading ? '\u00A0' : `${card.unique} ${t('analytics.common.unique_users')}`}
              </p>
            </div>
          )
        })}
      </div>

      <div className="border-t border-gray-100 px-5 pt-4 pb-2">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          {t('analytics.overview.daily_active_users')}
        </h3>
        {dauLoading ? (
          <div className="h-[240px] flex items-center justify-center text-gray-300">
            {t('analytics.common.loading')}
          </div>
        ) : dauRows.length === 0 ? (
          <div className="h-[240px] flex items-center justify-center text-gray-300">
            {t('analytics.common.no_data')}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={dauRows}>
              <defs>
                <linearGradient id="dauGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#93b5fd" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#93b5fd" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#f3f4f6"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: '#9ca3af' }}
                tickFormatter={(v) => {
                  const d = new Date(v)
                  return d.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })
                }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#9ca3af' }}
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) =>
                  v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v
                }
              />
              <Tooltip
                content={<ChartTooltip breakdownMap={breakdownMap} t={t} />}
                cursor={{ stroke: '#d1d5db', strokeWidth: 1 }}
              />
              <Area
                type="monotone"
                dataKey="dau"
                stroke="#6b8de3"
                strokeWidth={2}
                fill="url(#dauGradient)"
                dot={false}
                activeDot={{
                  r: 4,
                  fill: '#6b8de3',
                  stroke: '#fff',
                  strokeWidth: 2,
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="border-t border-gray-100 grid grid-cols-3 divide-x divide-gray-100">
        <div className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <GlobeHemisphereWest size={15} weight="duotone" className="text-blue-400" />
            <h3 className="text-sm font-semibold text-gray-700">{t('analytics.overview.countries')}</h3>
          </div>
          {countryLoading ? (
            <div className="h-[160px] flex items-center justify-center text-gray-300">{t('analytics.common.loading')}</div>
          ) : countryRows.length === 0 ? (
            <div className="h-[160px] flex items-center justify-center text-gray-300 text-xs">{t('analytics.common.no_data')}</div>
          ) : (
            <div className="space-y-1.5 overflow-y-auto h-[160px]">
              {countryRows.slice(0, 10).map((row: any, i: number) => {
                const maxVisits = countryRows[0]?.visits || 1
                const pct = Math.round((row.visits / maxVisits) * 100)
                return (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs w-6 text-gray-400 font-mono">{row.country_code}</span>
                    <div className="flex-1 h-5 bg-gray-50 rounded overflow-hidden relative">
                      <div
                        className="h-full bg-blue-100 rounded"
                        style={{ width: `${pct}%` }}
                      />
                      <span className="absolute inset-0 flex items-center px-2 text-[11px] text-gray-600 font-medium truncate">
                        {row.country_code}
                      </span>
                    </div>
                    <span className="text-[11px] text-gray-400 tabular-nums w-10 text-right">
                      {row.visits.toLocaleString()}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <Devices size={15} weight="duotone" className="text-indigo-400" />
            <h3 className="text-sm font-semibold text-gray-700">{t('analytics.overview.devices')}</h3>
          </div>
          {deviceLoading ? (
            <div className="h-[160px] flex items-center justify-center text-gray-300">{t('analytics.common.loading')}</div>
          ) : deviceRows.length === 0 ? (
            <div className="h-[160px] flex items-center justify-center text-gray-300 text-xs">{t('analytics.common.no_data')}</div>
          ) : (
            <div className="flex items-center gap-4 h-[160px]">
              <div className="flex-shrink-0">
                <ResponsiveContainer width={120} height={120}>
                  <PieChart>
                    <Pie
                      data={devicePieData}
                      dataKey="value"
                      cx="50%"
                      cy="50%"
                      innerRadius={32}
                      outerRadius={52}
                      paddingAngle={2}
                      strokeWidth={0}
                    >
                      {devicePieData.map((d: any, i: number) => (
                        <Cell key={i} fill={d.fill} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-2">
                {deviceRows.map((row: any, i: number) => {
                  const pct = totalDeviceVisits > 0
                    ? Math.round((row.visits / totalDeviceVisits) * 100)
                    : 0
                  return (
                    <div key={i} className="flex items-center gap-2">
                      {DEVICE_ICONS[row.device_type] || DEVICE_ICONS.unknown}
                      <span className="text-xs text-gray-600 capitalize flex-1">
                        {row.device_type}
                      </span>
                      <span className="text-xs font-medium text-gray-900 tabular-nums">
                        {pct}%
                      </span>
                      <span className="text-[11px] text-gray-400 tabular-nums w-10 text-right">
                        {row.unique_users.toLocaleString()}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <div className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <LinkSimple size={15} weight="duotone" className="text-green-400" />
            <h3 className="text-sm font-semibold text-gray-700">{t('analytics.overview.top_referrers')}</h3>
          </div>
          {referrerLoading ? (
            <div className="h-[160px] flex items-center justify-center text-gray-300">{t('analytics.common.loading')}</div>
          ) : referrerRows.length === 0 ? (
            <div className="h-[160px] flex items-center justify-center text-gray-300 text-xs">{t('analytics.common.no_data')}</div>
          ) : (
            <div className="space-y-1.5 overflow-y-auto h-[160px]">
              {referrerRows.slice(0, 8).map((row: any, i: number) => {
                const maxVisits = referrerRows[0]?.visits || 1
                const pct = Math.round((row.visits / maxVisits) * 100)
                return (
                  <div key={i} className="flex items-center gap-2">
                    <div className="flex-1 h-5 bg-gray-50 rounded overflow-hidden relative">
                      <div
                        className="h-full bg-green-100 rounded"
                        style={{ width: `${pct}%` }}
                      />
                      <span className="absolute inset-0 flex items-center px-2 text-[11px] text-gray-600 font-medium truncate">
                        {row.referrer_domain}
                      </span>
                    </div>
                    <span className="text-[11px] text-gray-400 tabular-nums w-10 text-right">
                      {row.visits.toLocaleString()}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>

      {/* Detail modals */}
      <AnalyticsDetailModal
        open={activeModal === 'live'}
        onOpenChange={(open) => !open && setActiveModal(null)}
        title={t('analytics.modals.live_users.title')}
        description={t('analytics.modals.live_users.description')}
        icon={<Broadcast size={18} weight="fill" className="text-green-500" />}
      >
        <LiveUsersDetail days={days} />
      </AnalyticsDetailModal>

      <AnalyticsDetailModal
        open={activeModal === 'signups'}
        onOpenChange={(open) => !open && setActiveModal(null)}
        title={t('analytics.modals.signups.title')}
        description={t('analytics.modals.signups.description', { days })}
        icon={<UserPlus size={18} weight="duotone" className="text-blue-400" />}
      >
        <SignupsDetail days={days} />
      </AnalyticsDetailModal>

      <AnalyticsDetailModal
        open={activeModal === 'enrollments'}
        onOpenChange={(open) => !open && setActiveModal(null)}
        title={t('analytics.modals.enrollments.title')}
        description={t('analytics.modals.enrollments.description', { days })}
        icon={<GraduationCap size={18} weight="duotone" className="text-indigo-400" />}
      >
        <EnrollmentsDetail days={days} />
      </AnalyticsDetailModal>

      <AnalyticsDetailModal
        open={activeModal === 'completions'}
        onOpenChange={(open) => !open && setActiveModal(null)}
        title={t('analytics.modals.completions.title')}
        description={t('analytics.modals.completions.description', { days })}
        icon={<CheckCircle size={18} weight="duotone" className="text-green-400" />}
      >
        <CompletionsDetail days={days} />
      </AnalyticsDetailModal>
    </>
  )
}
