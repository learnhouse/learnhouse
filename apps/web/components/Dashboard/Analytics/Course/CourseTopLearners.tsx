'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useCourseAnalyticsDetail } from '../useAnalyticsDashboard'
import { Trophy, Medal } from '@phosphor-icons/react'
import UserAvatar from '@components/Objects/UserAvatar'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import CourseWidgetCard, { WidgetIcon, AnimatedNumber, usePagination, PaginationBar } from './CourseWidgetCard'

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

const RANK_COLORS = ['text-amber-500', 'text-gray-400', 'text-orange-400']

function LearnerRow({
  row,
  index,
  users,
  compact = false,
  t,
}: {
  row: any
  index: number
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
      {index < 3 ? (
        <Medal size={compact ? 16 : 20} weight="fill" className={RANK_COLORS[index]} />
      ) : (
        <span className={`${compact ? 'text-[10px] w-4' : 'text-xs w-5'} text-gray-400 text-right font-medium`}>
          {index + 1}
        </span>
      )}
      <UserAvatar
        border="border-2"
        rounded="rounded-full"
        avatar_url={avatarUrl}
        predefined_avatar={avatarUrl ? undefined : 'empty'}
        width={compact ? 24 : 32}
      />
      <div className="flex-1 min-w-0">
        <p className={`${compact ? 'text-xs' : 'text-sm'} font-medium text-gray-900 truncate`}>{name}</p>
      </div>
      {compact ? (
        <span className="text-xs font-bold text-gray-900">{row.completions} {t('analytics.course_analytics.units.done')}</span>
      ) : (
        <div className="flex items-center gap-4 text-xs">
          <div className="text-center">
            <p className="font-bold text-gray-900">{row.completions}</p>
            <p className="text-gray-400">{t('analytics.course_analytics.units.done')}</p>
          </div>
          <div className="text-center">
            <p className="font-bold text-gray-900">{row.unique_activities_completed}</p>
            <p className="text-gray-400">{t('analytics.course_analytics.units.unique')}</p>
          </div>
          <div className="text-center">
            <p className="font-bold text-gray-900">{formatDuration(row.total_seconds_spent)}</p>
            <p className="text-gray-400">{t('analytics.course_analytics.units.time')}</p>
          </div>
        </div>
      )}
    </div>
  )
}

function TopLearnersModalContent({
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
      <div className="space-y-0.5">
        {pg.pageItems.map((row: any, i: number) => (
          <LearnerRow key={pg.page * 10 + i} row={row} index={pg.page * 10 + i} users={users} t={t} />
        ))}
      </div>
      <PaginationBar {...pg} />
    </div>
  )
}

export default function CourseTopLearners({
  courseId,
  days = '90',
}: {
  courseId: string
  days?: string
}) {
  const { t } = useTranslation()
  const { data, isLoading } = useCourseAnalyticsDetail('course_top_learners', courseId, { days })
  const rows = data?.data ?? []
  const users: Record<number, any> = data?.users ?? {}

  return (
    <CourseWidgetCard
      icon={<WidgetIcon icon={Trophy} bg="bg-amber-50" color="text-amber-500" weight="fill" />}
      title={t('analytics.course_analytics.top_learners.title')}
      subtitle={t('analytics.course_analytics.top_learners.subtitle')}
      modalContent={
        isLoading ? (
          <div className="h-80 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.loading')}</div>
        ) : rows.length === 0 ? (
          <div className="h-80 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.no_data')}</div>
        ) : (
          <TopLearnersModalContent rows={rows} users={users} t={t} />
        )
      }
    >
      {isLoading ? (
        <div className="h-40 flex items-center justify-center text-gray-300 text-sm">{t('analytics.course_analytics.common.loading')}</div>
      ) : rows.length === 0 ? (
        <div className="h-40 flex items-center justify-center text-gray-300 text-sm">{t('analytics.course_analytics.common.no_data')}</div>
      ) : (
        <div className="h-40">
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-2xl font-bold text-gray-900">
              <AnimatedNumber value={rows.length} />
            </span>
            <span className="text-xs text-gray-400">{t('analytics.course_analytics.units.active_learners')}</span>
          </div>
          <div className="space-y-0.5">
            {rows.slice(0, 3).map((row: any, i: number) => (
              <LearnerRow key={i} row={row} index={i} users={users} compact t={t} />
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
