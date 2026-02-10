'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useCoursePipe } from '../useAnalyticsDashboard'
import { getUriWithOrg } from '@services/config/config'
import { SignOut } from '@phosphor-icons/react'
import type { ActivityMap } from './CourseAnalyticsTab'
import CourseWidgetCard, { WidgetIcon, AnimatedNumber, usePagination, PaginationBar } from './CourseWidgetCard'

function DropoffRow({
  row,
  maxUsers,
  href,
  compact = false,
}: {
  row: any
  maxUsers: number
  href: string
  compact?: boolean
}) {
  const { t } = useTranslation()
  const barWidth = Math.max(((row.users_stopped_here || 0) / maxUsers) * 100, 2)
  return (
    <div className="flex items-center gap-3 py-1.5">
      <Link
        href={href}
        className={`${compact ? 'w-[130px]' : 'w-[180px]'} shrink-0 text-sm text-gray-700 font-medium truncate hover:text-rose-600 hover:underline transition-colors`}
        title={`${row.chapterName ? row.chapterName + ' — ' : ''}${row.displayName}`}
      >
        {row.displayName}
      </Link>
      <div className="flex-1 flex items-center gap-2">
        <div
          className="h-6 bg-rose-400 rounded-r-md transition-all"
          style={{ width: `${barWidth}%` }}
        />
        <span className="text-xs text-gray-500 whitespace-nowrap font-medium">
          {row.users_stopped_here} {row.users_stopped_here !== 1 ? t('analytics.course_analytics.units.learners') : t('analytics.course_analytics.units.learner')}
        </span>
      </div>
      {!compact && (
        <span className="text-[10px] text-gray-300 whitespace-nowrap">
          {t('analytics.course_analytics.common.avg_prefix', { value: Math.round(row.avg_completed_before_stop || 0) })} {t('analytics.course_analytics.units.done_before')}
        </span>
      )}
    </div>
  )
}

function DropoffModalContent({
  rows,
  maxUsers,
  totalDropoffs,
  orgslug,
  courseUuid,
}: {
  rows: any[]
  maxUsers: number
  totalDropoffs: number
  orgslug: string
  courseUuid: string
}) {
  const { t } = useTranslation()
  const pg = usePagination(rows, 10)

  return (
    <div>
      <div className="flex gap-6 mb-4">
        <div className="bg-rose-50 rounded-xl px-5 py-3">
          <p className="text-[10px] uppercase tracking-wider text-rose-400 font-semibold">{t('analytics.course_analytics.activity_dropoff.total_dropoffs')}</p>
          <p className="text-2xl font-bold text-rose-600">{totalDropoffs}</p>
        </div>
        <div className="bg-gray-50 rounded-xl px-5 py-3">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{t('analytics.course_analytics.activity_dropoff.dropoff_points')}</p>
          <p className="text-2xl font-bold text-gray-700">{rows.length}</p>
        </div>
      </div>
      <div className="space-y-1">
        {pg.pageItems.map((row: any, i: number) => (
          <DropoffRow
            key={pg.page * 10 + i}
            row={row}
            maxUsers={maxUsers}
            href={getUriWithOrg(orgslug, '') + `/course/${courseUuid}/activity/${row.activityUuid}`}
          />
        ))}
      </div>
      <PaginationBar {...pg} />
    </div>
  )
}

export default function CourseActivityDropoff({
  courseId,
  days = '90',
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
  const { data, isLoading } = useCoursePipe('course_activity_dropoff', courseId, { days })
  const rows = (data?.data ?? []).map((r: any) => {
    const info = activityMap[r.activity_uuid]
    return {
      ...r,
      displayName: info?.name || r.activity_name || t('analytics.course_analytics.common.unknown_activity'),
      chapterName: info?.chapterName || '',
      activityUuid: (r.activity_uuid || '').replace('activity_', ''),
    }
  })

  const maxUsers = Math.max(...rows.map((r: any) => r.users_stopped_here || 0), 1)
  const totalDropoffs = rows.reduce((s: number, r: any) => s + (r.users_stopped_here || 0), 0)

  return (
    <CourseWidgetCard
      icon={<WidgetIcon icon={SignOut} bg="bg-rose-50" color="text-rose-500" />}
      title={t('analytics.course_analytics.activity_dropoff.title')}
      subtitle={t('analytics.course_analytics.activity_dropoff.subtitle')}
      modalContent={
        isLoading ? (
          <div className="h-80 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.loading')}</div>
        ) : rows.length === 0 ? (
          <div className="h-80 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.no_data')}</div>
        ) : (
          <DropoffModalContent
            rows={rows}
            maxUsers={maxUsers}
            totalDropoffs={totalDropoffs}
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
            <span className="text-2xl font-bold text-rose-600">
              <AnimatedNumber value={totalDropoffs} />
            </span>
            <span className="text-xs text-gray-400">{t('analytics.course_analytics.units.total_dropoffs')}</span>
          </div>
          <div className="space-y-0.5">
            {rows.slice(0, 3).map((row: any, i: number) => (
              <DropoffRow
                key={i}
                row={row}
                maxUsers={maxUsers}
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
