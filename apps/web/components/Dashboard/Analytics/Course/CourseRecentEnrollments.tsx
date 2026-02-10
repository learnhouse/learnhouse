'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useCourseAnalyticsDetail } from '../useAnalyticsDashboard'
import { UserList } from '@phosphor-icons/react'
import UserAvatar from '@components/Objects/UserAvatar'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import CourseWidgetCard, { WidgetIcon, AnimatedNumber, usePagination, PaginationBar } from './CourseWidgetCard'

function EnrollmentRow({
  row,
  users,
  compact = false,
  t,
}: {
  row: any
  users: Record<number, any>
  compact?: boolean
  t: (key: string, options?: any) => string
}) {
  const user = users[row.user_id]
  const name = user
    ? `${user.first_name || ''} ${user.last_name || ''}`.trim() || `@${user.username}`
    : t('analytics.course_analytics.top_learners.user_fallback', { id: row.user_id })
  const avatarUrl = user?.avatar_image
    ? getUserAvatarMediaDirectory(user.user_uuid, user.avatar_image)
    : ''

  return (
    <div className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-gray-50">
      <UserAvatar
        border="border-2"
        rounded="rounded-full"
        avatar_url={avatarUrl}
        predefined_avatar={avatarUrl ? undefined : 'empty'}
        width={compact ? 24 : 32}
      />
      <div className="flex-1 min-w-0">
        <p className={`${compact ? 'text-xs' : 'text-sm'} font-medium text-gray-900 truncate`}>{name}</p>
        {!compact && user?.email && (
          <p className="text-xs text-gray-400 truncate">{user.email}</p>
        )}
      </div>
      <span className={`${compact ? 'text-[10px]' : 'text-xs'} text-gray-400 whitespace-nowrap`}>
        {new Date(row.timestamp).toLocaleDateString()}
      </span>
    </div>
  )
}

function EnrollmentsModalContent({
  rows,
  users,
  t,
}: {
  rows: any[]
  users: Record<number, any>
  t: (key: string, options?: any) => string
}) {
  const pg = usePagination(rows, 10)

  return (
    <div>
      <p className="text-sm text-gray-500 mb-3">{t('analytics.course_analytics.recent_enrollments.count_in_period', { count: rows.length })}</p>
      <div className="space-y-0.5">
        {pg.pageItems.map((row: any, i: number) => (
          <EnrollmentRow key={pg.page * 10 + i} row={row} users={users} t={t} />
        ))}
      </div>
      <PaginationBar {...pg} />
    </div>
  )
}

export default function CourseRecentEnrollments({
  courseId,
  days = '30',
}: {
  courseId: string
  days?: string
}) {
  const { t } = useTranslation()
  const { data, isLoading } = useCourseAnalyticsDetail('course_recent_enrollments', courseId, { days })
  const rows = data?.data ?? []
  const users: Record<number, any> = data?.users ?? {}

  return (
    <CourseWidgetCard
      icon={<WidgetIcon icon={UserList} bg="bg-indigo-50" color="text-indigo-500" />}
      title={t('analytics.course_analytics.recent_enrollments.title')}
      subtitle={t('analytics.course_analytics.recent_enrollments.subtitle')}
      modalContent={
        isLoading ? (
          <div className="h-80 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.loading')}</div>
        ) : rows.length === 0 ? (
          <div className="h-80 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.no_enrollments')}</div>
        ) : (
          <EnrollmentsModalContent rows={rows} users={users} t={t} />
        )
      }
    >
      {isLoading ? (
        <div className="h-40 flex items-center justify-center text-gray-300 text-sm">{t('analytics.course_analytics.common.loading')}</div>
      ) : rows.length === 0 ? (
        <div className="h-40 flex items-center justify-center text-gray-300 text-sm">{t('analytics.course_analytics.common.no_enrollments')}</div>
      ) : (
        <div className="h-40">
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-2xl font-bold text-gray-900">
              <AnimatedNumber value={rows.length} />
            </span>
            <span className="text-xs text-gray-400">{t('analytics.course_analytics.units.recent_enrollments')}</span>
          </div>
          <div className="space-y-0.5">
            {rows.slice(0, 3).map((row: any, i: number) => (
              <EnrollmentRow key={i} row={row} users={users} compact t={t} />
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
