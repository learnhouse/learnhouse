'use client'
import React, { useState } from 'react'
import { useAnalyticsPipe } from './useAnalyticsDashboard'
import { useOrg } from '@components/Contexts/OrgContext'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import Link from 'next/link'
import {
  Funnel,
  Trophy,
  Lightning,
  Eye,
  Users as UsersIcon,
  CheckCircle,
  BookOpen,
  Play,
  Timer,
  ArrowsOutSimple,
} from '@phosphor-icons/react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import AnalyticsDetailModal from './AnalyticsDetailModal'
import { useTranslation } from 'react-i18next'

const COLORS = ['#6b8de3', '#818cf8', '#a78bfa', '#c4b5fd']

function BarTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white nice-shadow rounded-lg px-3 py-2 text-sm">
      <p className="text-gray-500 text-xs mb-0.5">{payload[0].payload.name}</p>
      <p className="text-gray-900 font-bold">
        {payload[0].value.toLocaleString()}
      </p>
    </div>
  )
}

function ExpandButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="p-1 rounded-md hover:bg-gray-100 transition-colors text-gray-300 hover:text-gray-500"
      title="Expand"
    >
      <ArrowsOutSimple size={14} />
    </button>
  )
}

export default function CoreWidgetsRow({ days = '30' }: { days?: string }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const { data: funnelData, isLoading: funnelLoading } = useAnalyticsPipe(
    'enrollment_funnel',
    { days }
  )
  const { data: coursesData, isLoading: coursesLoading } = useAnalyticsPipe(
    'top_courses',
    { days }
  )
  const { data: activityData, isLoading: activityLoading } = useAnalyticsPipe(
    'activity_engagement',
    { days }
  )

  const [funnelOpen, setFunnelOpen] = useState(false)
  const [coursesOpen, setCoursesOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)

  const funnelRow = funnelData?.data?.[0]
  const chartData = funnelRow
    ? [
        { name: t('analytics.overview.page_views'), value: funnelRow.page_views },
        { name: t('analytics.overview.course_views'), value: funnelRow.course_views },
        { name: t('analytics.common.enrollments'), value: funnelRow.enrollments },
        { name: t('analytics.common.completions'), value: funnelRow.completions },
      ]
    : []

  const courseRows = coursesData?.data ?? []
  const activityRows = activityData?.data ?? []

  return (
    <>
      <div className="bg-white nice-shadow rounded-xl overflow-hidden flex divide-x divide-gray-100">
        {/* {t('analytics.overview.enrollment_funnel')} */}
        <div className="flex-1 p-5 min-w-0">
          <div className="flex items-center gap-2 mb-4">
            <Funnel size={16} weight="duotone" className="text-indigo-400" />
            <h3 className="text-sm font-semibold text-gray-700">
              {t('analytics.overview.enrollment_funnel')}
            </h3>
            <div className="ml-auto">
              <ExpandButton onClick={() => setFunnelOpen(true)} />
            </div>
          </div>
          {funnelLoading ? (
            <div className="h-[220px] flex items-center justify-center text-gray-300">
              {t('analytics.common.loading')}
            </div>
          ) : chartData.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-gray-300">
              {t('analytics.common.no_data')}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} layout="vertical" barCategoryGap="20%">
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) =>
                    v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v
                  }
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  width={90}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  content={<BarTooltip />}
                  cursor={{ fill: '#f9fafb' }}
                />
                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Top Courses */}
        <div className="flex-1 p-5 min-w-0">
          <div className="flex items-center gap-2 mb-4">
            <Trophy size={16} weight="duotone" className="text-amber-400" />
            <h3 className="text-sm font-semibold text-gray-700">{t('analytics.overview.top_courses')}</h3>
            <div className="ml-auto">
              <ExpandButton onClick={() => setCoursesOpen(true)} />
            </div>
          </div>
          {coursesLoading ? (
            <div className="h-[220px] flex items-center justify-center text-gray-300">
              {t('analytics.common.loading')}
            </div>
          ) : courseRows.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-gray-300">
              {t('analytics.common.no_data')}
            </div>
          ) : (
            <div className="overflow-y-auto h-[220px] space-y-1.5">
              {courseRows.slice(0, 8).map((row: any, i: number) => (
                <CourseRow key={i} row={row} org={org} />
              ))}
            </div>
          )}
        </div>

        {/* {t('analytics.overview.activity_engagement')} */}
        <div className="flex-1 p-5 min-w-0">
          <div className="flex items-center gap-2 mb-4">
            <Lightning size={16} weight="duotone" className="text-green-400" />
            <h3 className="text-sm font-semibold text-gray-700">
              {t('analytics.overview.activity_engagement')}
            </h3>
            <div className="ml-auto">
              <ExpandButton onClick={() => setActivityOpen(true)} />
            </div>
          </div>
          {activityLoading ? (
            <div className="h-[220px] flex items-center justify-center text-gray-300">
              {t('analytics.common.loading')}
            </div>
          ) : activityRows.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-gray-300">
              {t('analytics.common.no_data')}
            </div>
          ) : (
            <div className="overflow-y-auto h-[220px] space-y-1.5">
              {activityRows.slice(0, 10).map((row: any, i: number) => (
                <ActivityRow key={i} row={row} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ---- Detail Modals ---- */}

      {/* Funnel Detail */}
      <AnalyticsDetailModal
        open={funnelOpen}
        onClose={() => setFunnelOpen(false)}
        title="{t('analytics.overview.enrollment_funnel')}"
        icon={<Funnel size={20} weight="duotone" className="text-indigo-400" />}
      >
        {chartData.length === 0 ? (
          <div className="text-center text-gray-300 py-12">{t('analytics.common.no_data')}</div>
        ) : (
          <div className="space-y-6">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} layout="vertical" barCategoryGap="20%">
                <XAxis
                  type="number"
                  tick={{ fontSize: 12, fill: '#9ca3af' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) =>
                    v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v
                  }
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 13, fill: '#374151' }}
                  width={110}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<BarTooltip />} cursor={{ fill: '#f9fafb' }} />
                <Bar dataKey="value" radius={[0, 8, 8, 0]}>
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            {/* Conversion rates */}
            <div className="grid grid-cols-3 gap-4">
              {[
                {
                  label: t('analytics.overview.view_to_enroll'),
                  from: funnelRow?.course_views,
                  to: funnelRow?.enrollments,
                },
                {
                  label: t('analytics.overview.enroll_to_complete'),
                  from: funnelRow?.enrollments,
                  to: funnelRow?.completions,
                },
                {
                  label: t('analytics.overview.page_to_complete'),
                  from: funnelRow?.page_views,
                  to: funnelRow?.completions,
                },
              ].map((step) => {
                const rate =
                  step.from > 0
                    ? ((step.to / step.from) * 100).toFixed(1)
                    : '0'
                return (
                  <div
                    key={step.label}
                    className="bg-gray-50 rounded-xl p-4 text-center"
                  >
                    <p className="text-xs text-gray-400 mb-1">{step.label}</p>
                    <p className="text-2xl font-bold text-gray-900">{rate}%</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {(step.to ?? 0).toLocaleString()} / {(step.from ?? 0).toLocaleString()}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </AnalyticsDetailModal>

      {/* Top Courses Detail */}
      <AnalyticsDetailModal
        open={coursesOpen}
        onClose={() => setCoursesOpen(false)}
        title="Top Courses"
        icon={<Trophy size={20} weight="duotone" className="text-amber-400" />}
      >
        {courseRows.length === 0 ? (
          <div className="text-center text-gray-300 py-12">{t('analytics.common.no_data')}</div>
        ) : (
          <div className="space-y-1">
            {/* Header */}
            <div className="grid grid-cols-[1fr_80px_80px_80px_100px] gap-2 px-3 py-2 text-[11px] text-gray-400 font-medium uppercase tracking-wider">
              <span>{t('analytics.common.course')}</span>
              <span className="text-right">{t('analytics.common.views')}</span>
              <span className="text-right">{t('analytics.common.enrollments')}</span>
              <span className="text-right">{t('analytics.common.completions')}</span>
              <span className="text-right">{t('analytics.overview.conv_rate')}</span>
            </div>
            {courseRows.map((row: any, i: number) => {
              const thumbnail =
                row.thumbnail_image && row.course_uuid
                  ? getCourseThumbnailMediaDirectory(
                      org?.org_uuid,
                      row.course_uuid,
                      row.thumbnail_image
                    )
                  : null
              const rate =
                row.views > 0
                  ? ((row.enrollments / row.views) * 100).toFixed(1)
                  : '0'
              const courseUuid = row.course_uuid
              const cleanUuid = courseUuid
                ? courseUuid.replace('course_', '')
                : null
              const href = cleanUuid
                ? `/dash/courses/course/${cleanUuid}/general`
                : `/dash/courses`

              return (
                <Link
                  key={i}
                  href={href}
                  className="grid grid-cols-[1fr_80px_80px_80px_100px] gap-2 items-center px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-colors group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-gray-100 flex-shrink-0 overflow-hidden flex items-center justify-center">
                      {thumbnail ? (
                        <img
                          src={thumbnail}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <BookOpen
                          size={16}
                          weight="duotone"
                          className="text-gray-300"
                        />
                      )}
                    </div>
                    <span className="text-sm text-gray-700 truncate group-hover:text-gray-900 font-medium">
                      {row.course_name || `Course ${row.course_id}`}
                    </span>
                  </div>
                  <span className="text-sm text-gray-600 text-right tabular-nums">
                    {row.views.toLocaleString()}
                  </span>
                  <span className="text-sm text-gray-600 text-right tabular-nums">
                    {row.enrollments.toLocaleString()}
                  </span>
                  <span className="text-sm text-gray-600 text-right tabular-nums">
                    {row.completions.toLocaleString()}
                  </span>
                  <span className="text-sm text-right tabular-nums">
                    <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded-md text-xs font-medium">
                      {rate}%
                    </span>
                  </span>
                </Link>
              )
            })}
          </div>
        )}
      </AnalyticsDetailModal>

      {/* {t('analytics.overview.activity_engagement')} Detail */}
      <AnalyticsDetailModal
        open={activityOpen}
        onClose={() => setActivityOpen(false)}
        title="{t('analytics.overview.activity_engagement')}"
        icon={
          <Lightning size={20} weight="duotone" className="text-green-400" />
        }
      >
        {activityRows.length === 0 ? (
          <div className="text-center text-gray-300 py-12">{t('analytics.common.no_data')}</div>
        ) : (
          <div className="space-y-1">
            {/* Header */}
            <div className="grid grid-cols-[1fr_60px_70px_80px_90px] gap-2 px-3 py-2 text-[11px] text-gray-400 font-medium uppercase tracking-wider">
              <span>{t('analytics.overview.activity')}</span>
              <span className="text-right">{t('analytics.common.type')}</span>
              <span className="text-right">{t('analytics.common.views')}</span>
              <span className="text-right">{t('analytics.common.completions')}</span>
              <span className="text-right">{t('analytics.overview.avg_time')}</span>
            </div>
            {activityRows.map((row: any, i: number) => {
              const typeIcon =
                row.activity_type === 'video' ? (
                  <Play size={14} weight="duotone" className="text-blue-300" />
                ) : (
                  <BookOpen
                    size={14}
                    weight="duotone"
                    className="text-gray-300"
                  />
                )
              const activityHref =
                row.course_uuid && row.activity_id
                  ? `/course/${row.course_uuid}/activity/${row.activity_id}`
                  : null
              const Wrapper = activityHref ? Link : 'div'
              const wrapperProps = activityHref ? { href: activityHref } : {}
              const avgTime = row.avg_seconds_spent
                ? row.avg_seconds_spent >= 60
                  ? `${Math.round(row.avg_seconds_spent / 60)}m`
                  : `${Math.round(row.avg_seconds_spent)}s`
                : '—'

              return (
                <Wrapper
                  key={i}
                  {...(wrapperProps as any)}
                  className="grid grid-cols-[1fr_60px_70px_80px_90px] gap-2 items-center px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-colors group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-gray-50 flex-shrink-0 flex items-center justify-center">
                      {typeIcon}
                    </div>
                    <span className="text-sm text-gray-700 truncate group-hover:text-gray-900 font-medium">
                      {row.activity_name || row.activity_id}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400 text-right capitalize">
                    {row.activity_type}
                  </span>
                  <span className="text-sm text-gray-600 text-right tabular-nums">
                    {row.views.toLocaleString()}
                  </span>
                  <span className="text-sm text-gray-600 text-right tabular-nums">
                    {row.completions.toLocaleString()}
                  </span>
                  <span className="text-sm text-gray-600 text-right tabular-nums">
                    {avgTime}
                  </span>
                </Wrapper>
              )
            })}
          </div>
        )}
      </AnalyticsDetailModal>
    </>
  )
}

/* ---- Shared row components ---- */

function CourseRow({ row, org }: { row: any; org: any }) {
  const thumbnail =
    row.thumbnail_image && row.course_uuid
      ? getCourseThumbnailMediaDirectory(
          org?.org_uuid,
          row.course_uuid,
          row.thumbnail_image
        )
      : null
  const courseUuid = row.course_uuid
  const cleanUuid = courseUuid ? courseUuid.replace('course_', '') : null
  const href = cleanUuid
    ? `/dash/courses/course/${cleanUuid}/general`
    : `/dash/courses`

  return (
    <Link
      href={href}
      className="flex items-center gap-3 p-2 -mx-1 rounded-lg hover:bg-gray-50 transition-colors group cursor-pointer"
    >
      <div className="w-10 h-10 rounded-lg bg-gray-100 flex-shrink-0 overflow-hidden flex items-center justify-center">
        {thumbnail ? (
          <img src={thumbnail} alt="" className="w-full h-full object-cover" />
        ) : (
          <BookOpen size={18} weight="duotone" className="text-gray-300" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-700 truncate group-hover:text-gray-900">
          {row.course_name || `Course ${row.course_id}`}
        </p>
        <div className="flex items-center gap-3 text-[11px] text-gray-400">
          <span className="flex items-center gap-0.5">
            <Eye size={11} />
            {row.views}
          </span>
          <span className="flex items-center gap-0.5">
            <UsersIcon size={11} />
            {row.enrollments}
          </span>
          <span className="flex items-center gap-0.5">
            <CheckCircle size={11} />
            {row.completions}
          </span>
        </div>
      </div>
    </Link>
  )
}

function ActivityRow({ row }: { row: any }) {
  const typeIcon =
    row.activity_type === 'video' ? (
      <Play size={14} weight="duotone" className="text-blue-300" />
    ) : (
      <BookOpen size={14} weight="duotone" className="text-gray-300" />
    )
  const activityHref =
    row.course_uuid && row.activity_id
      ? `/course/${row.course_uuid}/activity/${row.activity_id}`
      : null
  const Wrapper = activityHref ? Link : 'div'
  const wrapperProps = activityHref ? { href: activityHref } : {}

  return (
    <Wrapper
      {...(wrapperProps as any)}
      className="flex items-center gap-3 p-2 -mx-1 rounded-lg hover:bg-gray-50 transition-colors group cursor-pointer"
    >
      <div className="w-8 h-8 rounded-lg bg-gray-50 flex-shrink-0 flex items-center justify-center">
        {typeIcon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-700 truncate group-hover:text-gray-900">
          {row.activity_name || row.activity_id}
        </p>
        <div className="flex items-center gap-3 text-[11px] text-gray-400">
          <span className="capitalize">{row.activity_type}</span>
          <span className="flex items-center gap-0.5">
            <Eye size={11} />
            {row.views}
          </span>
          <span className="flex items-center gap-0.5">
            <CheckCircle size={11} />
            {row.completions}
          </span>
          {row.avg_seconds_spent ? (
            <span className="flex items-center gap-0.5">
              <Timer size={11} />
              {Math.round(row.avg_seconds_spent)}s
            </span>
          ) : null}
        </div>
      </div>
    </Wrapper>
  )
}
