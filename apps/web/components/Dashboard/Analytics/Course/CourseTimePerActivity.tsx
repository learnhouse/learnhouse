'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useCoursePipe } from '../useAnalyticsDashboard'
import { getUriWithOrg } from '@services/config/config'
import { Hourglass } from '@phosphor-icons/react'
import type { ActivityMap } from './CourseAnalyticsTab'
import CourseWidgetCard, { WidgetIcon, usePagination, PaginationBar } from './CourseWidgetCard'

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function TimeBar({
  row,
  maxSeconds,
  href,
  compact = false,
}: {
  row: any
  maxSeconds: number
  href: string
  compact?: boolean
}) {
  const { t } = useTranslation()
  const barWidth = Math.max(((row.avg_seconds_spent || 0) / maxSeconds) * 100, 2)
  return (
    <div className="flex items-center gap-3 py-1.5">
      <Link
        href={href}
        className={`${compact ? 'w-[130px]' : 'w-[180px]'} shrink-0 text-sm text-gray-700 font-medium truncate hover:text-indigo-600 hover:underline transition-colors`}
        title={`${row.chapterName ? row.chapterName + ' — ' : ''}${row.displayName}`}
      >
        {row.displayName}
      </Link>
      <div className="flex-1 flex items-center gap-2">
        <div
          className="h-6 bg-amber-400 rounded-r-md transition-all"
          style={{ width: `${barWidth}%` }}
        />
        <span className="text-xs text-gray-500 whitespace-nowrap font-medium">
          {formatDuration(row.avg_seconds_spent || 0)}
        </span>
      </div>
      {!compact && (
        <span className="text-[10px] text-gray-300 whitespace-nowrap">
          {row.samples} {row.samples !== 1 ? t('analytics.course_analytics.units.samples') : t('analytics.course_analytics.units.sample')}
        </span>
      )}
    </div>
  )
}

function TimeModalContent({
  rows,
  maxSeconds,
  overallAvg,
  totalSamples,
  orgslug,
  courseUuid,
}: {
  rows: any[]
  maxSeconds: number
  overallAvg: number
  totalSamples: number
  orgslug: string
  courseUuid: string
}) {
  const { t } = useTranslation()
  const pg = usePagination(rows, 10)

  return (
    <div>
      <div className="flex gap-6 mb-4">
        <div className="bg-amber-50 rounded-xl px-5 py-3">
          <p className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">{t('analytics.overview.activities')}</p>
          <p className="text-2xl font-bold text-amber-600">{rows.length}</p>
        </div>
        <div className="bg-gray-50 rounded-xl px-5 py-3">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{t('analytics.course_analytics.common.avg_time')}</p>
          <p className="text-2xl font-bold text-gray-700">{formatDuration(overallAvg)}</p>
        </div>
        <div className="bg-gray-50 rounded-xl px-5 py-3">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{t('analytics.course_analytics.common.total_samples')}</p>
          <p className="text-2xl font-bold text-gray-700">{totalSamples}</p>
        </div>
      </div>
      <div className="space-y-1">
        {pg.pageItems.map((row: any, i: number) => (
          <TimeBar
            key={pg.page * 10 + i}
            row={row}
            maxSeconds={maxSeconds}
            href={getUriWithOrg(orgslug, '') + `/course/${courseUuid}/activity/${row.activityUuid}`}
          />
        ))}
      </div>
      <PaginationBar {...pg} />
    </div>
  )
}

export default function CourseTimePerActivity({
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
  const { data, isLoading } = useCoursePipe('course_time_per_activity', courseId, { days })
  const rows = (data?.data ?? []).map((r: any) => {
    const info = activityMap[r.activity_uuid]
    return {
      ...r,
      displayName: info?.name || r.activity_name || t('analytics.course_analytics.common.unknown_activity'),
      chapterName: info?.chapterName || '',
      activityUuid: (r.activity_uuid || '').replace('activity_', ''),
    }
  })

  const maxSeconds = Math.max(...rows.map((r: any) => r.avg_seconds_spent || 0), 1)
  const totalSamples = rows.reduce((s: number, r: any) => s + (r.samples || 0), 0)
  const overallAvg = rows.length > 0
    ? Math.round(rows.reduce((s: number, r: any) => s + (r.avg_seconds_spent || 0), 0) / rows.length)
    : 0

  return (
    <CourseWidgetCard
      icon={<WidgetIcon icon={Hourglass} bg="bg-amber-50" color="text-amber-500" />}
      title={t('analytics.course_analytics.time_per_activity.title')}
      subtitle={t('analytics.course_analytics.time_per_activity.subtitle')}
      modalContent={
        isLoading ? (
          <div className="h-80 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.loading')}</div>
        ) : rows.length === 0 ? (
          <div className="h-80 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.no_data')}</div>
        ) : (
          <TimeModalContent
            rows={rows}
            maxSeconds={maxSeconds}
            overallAvg={overallAvg}
            totalSamples={totalSamples}
            orgslug={orgslug}
            courseUuid={courseUuid}
          />
        )
      }
    >
      {isLoading ? (
        <div className="h-40 flex items-center justify-center text-gray-300 text-sm">{t('analytics.course_analytics.common.loading')}</div>
      ) : rows.length === 0 ? (
        <div className="h-40 flex items-center justify-center text-gray-300 text-sm">{t('analytics.course_analytics.common.no_data')}</div>
      ) : (
        <div className="h-40 overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400">{t('analytics.course_analytics.common.activities_count', { count: rows.length })}</span>
            <span className="text-xs font-medium text-amber-600">{t('analytics.course_analytics.common.avg_prefix', { value: formatDuration(overallAvg) })}</span>
          </div>
          <div className="space-y-0.5">
            {rows.slice(0, 3).map((row: any, i: number) => (
              <TimeBar
                key={i}
                row={row}
                maxSeconds={maxSeconds}
                href={getUriWithOrg(orgslug, '') + `/course/${courseUuid}/activity/${row.activityUuid}`}
                compact
              />
            ))}
          </div>
          {rows.length > 3 && (
            <p className="text-[10px] text-gray-300 text-center mt-1">
              {t('analytics.course_analytics.common.more_expand', { count: rows.length - 3 })}
            </p>
          )}
        </div>
      )}
    </CourseWidgetCard>
  )
}
