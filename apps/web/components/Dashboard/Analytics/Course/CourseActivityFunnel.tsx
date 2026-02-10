'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useCoursePipe } from '../useAnalyticsDashboard'
import { getUriWithOrg } from '@services/config/config'
import { Funnel, Eye, CheckCircle, WarningCircle } from '@phosphor-icons/react'
import type { ActivityMap } from './CourseAnalyticsTab'
import CourseWidgetCard, { WidgetIcon, AnimatedNumber, usePagination, PaginationBar } from './CourseWidgetCard'

function getRateColor(rate: number) {
  if (rate >= 70) return { bg: 'bg-emerald-50', text: 'text-emerald-600', bar: 'bg-emerald-500', ring: 'ring-emerald-200' }
  if (rate >= 40) return { bg: 'bg-amber-50', text: 'text-amber-600', bar: 'bg-amber-400', ring: 'ring-amber-200' }
  return { bg: 'bg-rose-50', text: 'text-rose-600', bar: 'bg-rose-400', ring: 'ring-rose-200' }
}

function FunnelStep({
  row,
  index,
  total,
  maxViews,
  href,
}: {
  row: any
  index: number
  total: number
  maxViews: number
  href: string
}) {
  const { t } = useTranslation()
  const rate = row.completion_rate || 0
  const colors = getRateColor(rate)
  const viewsWidth = maxViews > 0 ? Math.max((row.views / maxViews) * 100, 8) : 8
  const completionFill = row.views > 0 ? (row.completions / row.views) * 100 : 0

  return (
    <div className="group">
      <div className="flex items-stretch gap-4">
        <div className="flex flex-col items-center w-8 shrink-0">
          <div className={`w-7 h-7 rounded-full ${colors.bg} flex items-center justify-center text-xs font-bold ${colors.text} ring-2 ${colors.ring}`}>
            {index + 1}
          </div>
          {index < total - 1 && (
            <div className="w-px flex-1 bg-gray-200 my-1" />
          )}
        </div>
        <div className="flex-1 pb-5 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <Link
              href={href}
              className="text-sm font-semibold text-gray-800 truncate hover:text-indigo-600 hover:underline transition-colors"
              title={`${row.chapterName ? row.chapterName + ' — ' : ''}${row.displayName}`}
            >
              {row.displayName}
            </Link>
            {row.chapterName && (
              <span className="text-[10px] text-gray-300 shrink-0">{row.chapterName}</span>
            )}
          </div>
          <div className="relative mb-2" style={{ width: `${viewsWidth}%` }}>
            <div className="h-8 rounded-lg bg-indigo-100 relative overflow-hidden">
              <div
                className={`absolute inset-y-0 left-0 rounded-lg ${colors.bar} transition-all duration-500`}
                style={{ width: `${completionFill}%` }}
              />
              <div className="absolute inset-0 flex items-center justify-between px-3">
                <span className="text-[11px] font-bold text-white mix-blend-difference">
                  {rate}%
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1 text-indigo-500">
              <Eye size={12} weight="bold" />
              {row.views} {t('analytics.course_analytics.units.views')}
            </span>
            <span className="flex items-center gap-1 text-emerald-500">
              <CheckCircle size={12} weight="fill" />
              {row.completions} {t('analytics.course_analytics.units.completed')}
            </span>
            {rate < 30 && row.views > 5 && (
              <span className="flex items-center gap-1 text-rose-400">
                <WarningCircle size={12} weight="fill" />
                {t('analytics.course_analytics.common.low_conversion')}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function CompactFunnelRow({ row, maxViews }: { row: any; maxViews: number }) {
  const rate = row.completion_rate || 0
  const colors = getRateColor(rate)
  const barWidth = maxViews > 0 ? Math.max((row.views / maxViews) * 100, 10) : 10
  const completionFill = row.views > 0 ? (row.completions / row.views) * 100 : 0

  return (
    <div className="flex items-center gap-3">
      <span className="w-[110px] shrink-0 text-xs text-gray-600 font-medium truncate">
        {row.displayName}
      </span>
      <div className="flex-1 relative" style={{ width: `${barWidth}%` }}>
        <div className="h-5 rounded-md bg-indigo-100 relative overflow-hidden">
          <div
            className={`absolute inset-y-0 left-0 rounded-md ${colors.bar} transition-all`}
            style={{ width: `${completionFill}%` }}
          />
        </div>
      </div>
      <span className={`text-xs font-bold ${colors.text} w-10 text-right`}>
        {rate}%
      </span>
    </div>
  )
}

function FunnelModalContent({
  rows,
  maxViews,
  totalViews,
  totalCompletions,
  avgRate,
  lowConversion,
  orgslug,
  courseUuid,
}: {
  rows: any[]
  maxViews: number
  totalViews: number
  totalCompletions: number
  avgRate: number
  lowConversion: any[]
  orgslug: string
  courseUuid: string
}) {
  const { t } = useTranslation()
  const pg = usePagination(rows, 8)

  return (
    <div className="space-y-5">
      <div className="flex gap-4">
        <div className="bg-indigo-50 rounded-xl px-5 py-3 flex-1">
          <p className="text-[10px] uppercase tracking-wider text-indigo-400 font-semibold">{t('analytics.course_analytics.common.total_views')}</p>
          <p className="text-2xl font-bold text-indigo-600">{totalViews}</p>
        </div>
        <div className="bg-emerald-50 rounded-xl px-5 py-3 flex-1">
          <p className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold">{t('analytics.course_analytics.common.total_completions')}</p>
          <p className="text-2xl font-bold text-emerald-600">{totalCompletions}</p>
        </div>
        <div className="bg-gray-50 rounded-xl px-5 py-3 flex-1">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{t('analytics.course_analytics.common.avg_rate')}</p>
          <p className="text-2xl font-bold text-gray-700">{avgRate}%</p>
        </div>
        {lowConversion.length > 0 && (
          <div className="bg-rose-50 rounded-xl px-5 py-3 flex-1">
            <p className="text-[10px] uppercase tracking-wider text-rose-400 font-semibold">{t('analytics.course_analytics.common.needs_attention')}</p>
            <p className="text-2xl font-bold text-rose-600">{lowConversion.length}</p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-6 text-xs text-gray-400 px-1">
        <span>{t('analytics.course_analytics.common.bar_width_hint')}</span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-emerald-500" /> {t('analytics.course_analytics.common.rate_high')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-amber-400" /> {t('analytics.course_analytics.common.rate_mid')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-rose-400" /> {t('analytics.course_analytics.common.rate_low')}
        </span>
      </div>

      <div>
        {pg.pageItems.map((row: any, i: number) => (
          <FunnelStep
            key={pg.page * 8 + i}
            row={row}
            index={pg.page * 8 + i}
            total={rows.length}
            maxViews={maxViews}
            href={getUriWithOrg(orgslug, '') + `/course/${courseUuid}/activity/${row.activityUuid}`}
          />
        ))}
      </div>

      <PaginationBar {...pg} />
    </div>
  )
}

export default function CourseActivityFunnel({
  courseId,
  days = '30',
  activityMap,
  orgslug,
  courseUuid,
}: {
  courseId: string | number
  days?: string
  activityMap: ActivityMap
  orgslug: string
  courseUuid: string
}) {
  const { t } = useTranslation()
  const { data, isLoading } = useCoursePipe('course_activity_funnel', courseId, { days })
  const rows = (data?.data ?? []).map((r: any) => {
    const info = activityMap[r.activity_uuid]
    return {
      ...r,
      displayName: info?.name || r.activity_name || t('analytics.course_analytics.common.unknown_activity'),
      chapterName: info?.chapterName || '',
      activityUuid: (r.activity_uuid || '').replace('activity_', ''),
    }
  })

  const maxViews = Math.max(...rows.map((r: any) => r.views || 0), 1)
  const totalViews = rows.reduce((s: number, r: any) => s + (r.views || 0), 0)
  const totalCompletions = rows.reduce((s: number, r: any) => s + (r.completions || 0), 0)
  const avgRate = rows.length > 0
    ? Math.round(rows.reduce((s: number, r: any) => s + (r.completion_rate || 0), 0) / rows.length)
    : 0
  const lowConversion = rows.filter((r: any) => (r.completion_rate || 0) < 30 && (r.views || 0) > 5)

  const empty = !isLoading && rows.length === 0

  return (
    <CourseWidgetCard
      icon={<WidgetIcon icon={Funnel} bg="bg-indigo-50" color="text-indigo-500" />}
      title={t('analytics.course_analytics.activity_funnel.title')}
      subtitle={t('analytics.course_analytics.activity_funnel.subtitle')}
      modalContent={
        isLoading ? (
          <div className="h-96 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.loading')}</div>
        ) : empty ? (
          <div className="h-96 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.no_data')}</div>
        ) : (
          <FunnelModalContent
            rows={rows}
            maxViews={maxViews}
            totalViews={totalViews}
            totalCompletions={totalCompletions}
            avgRate={avgRate}
            lowConversion={lowConversion}
            orgslug={orgslug}
            courseUuid={courseUuid}
          />
        )
      }
    >
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-gray-300 text-sm">{t('analytics.course_analytics.common.loading')}</div>
      ) : empty ? (
        <div className="h-48 flex items-center justify-center text-gray-300 text-sm">{t('analytics.course_analytics.common.no_data')}</div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-gray-900"><AnimatedNumber value={avgRate} suffix="%" /></span>
              <span className="text-xs text-gray-400">{t('analytics.course_analytics.common.avg_completion')}</span>
            </div>
            <span className="text-xs text-gray-400">{t('analytics.course_analytics.common.activities_count', { count: rows.length })}</span>
          </div>
          <div className="space-y-1.5">
            {rows.slice(0, 5).map((row: any, i: number) => (
              <CompactFunnelRow key={i} row={row} maxViews={maxViews} />
            ))}
          </div>
          {rows.length > 5 && (
            <p className="text-[10px] text-gray-300 text-center mt-2">
              {t('analytics.course_analytics.common.more_expand', { count: rows.length - 5 })}
            </p>
          )}
        </div>
      )}
    </CourseWidgetCard>
  )
}
