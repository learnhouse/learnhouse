'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useCoursePipe } from '../useAnalyticsDashboard'
import { Pulse } from '@phosphor-icons/react'
import CourseWidgetCard, { WidgetIcon, AnimatedNumber } from './CourseWidgetCard'

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

export default function CourseEngagementByType({
  courseId,
  days = '30',
}: {
  courseId: string | number
  days?: string
}) {
  const { t } = useTranslation()
  const getTypeLabel = (type: string) => t('analytics.course_analytics.type_labels.' + type) || type
  const { data, isLoading } = useCoursePipe('course_engagement_by_type', courseId, { days })
  const rows = data?.data ?? []

  const totalEvents = rows.reduce((s: number, r: any) => s + (r.total_events || 0), 0)
  const totalLearners = rows.reduce((s: number, r: any) => s + (r.unique_learners || 0), 0)

  return (
    <CourseWidgetCard
      icon={<WidgetIcon icon={Pulse} bg="bg-orange-50" color="text-orange-500" />}
      title={t('analytics.course_analytics.engagement_by_type.title')}
      subtitle={t('analytics.course_analytics.engagement_by_type.subtitle')}
      modalContent={
        isLoading ? (
          <div className="h-80 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.loading')}</div>
        ) : rows.length === 0 ? (
          <div className="h-80 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.no_data')}</div>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-6 text-sm">
              <div>
                <p className="text-gray-400 text-xs">{t('analytics.course_analytics.engagement_by_type.total_events')}</p>
                <p className="text-xl font-bold text-gray-900">{totalEvents}</p>
              </div>
              <div>
                <p className="text-gray-400 text-xs">{t('analytics.course_analytics.engagement_by_type.total_learners')}</p>
                <p className="text-xl font-bold text-orange-600">{totalLearners}</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                    <th className="pb-2 font-medium">{t('analytics.course_analytics.common.type')}</th>
                    <th className="pb-2 font-medium text-right">{t('analytics.course_analytics.units.learners')}</th>
                    <th className="pb-2 font-medium text-right">{t('analytics.course_analytics.units.events')}</th>
                    <th className="pb-2 font-medium text-right">{t('analytics.course_analytics.common.completions')}</th>
                    <th className="pb-2 font-medium text-right">{t('analytics.course_analytics.common.avg_time')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row: any, i: number) => (
                    <tr key={i} className="border-b border-gray-50 last:border-0">
                      <td className="py-2.5 font-medium text-gray-700">
                        {getTypeLabel(row.activity_type)}
                      </td>
                      <td className="py-2.5 text-right text-gray-600">{row.unique_learners}</td>
                      <td className="py-2.5 text-right text-gray-600">{row.total_events}</td>
                      <td className="py-2.5 text-right text-emerald-600 font-medium">{row.completions}</td>
                      <td className="py-2.5 text-right text-gray-500">{formatDuration(row.avg_seconds_spent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      }
    >
      {isLoading ? (
        <div className="h-40 flex items-center justify-center text-gray-300 text-sm">{t('analytics.course_analytics.common.loading')}</div>
      ) : rows.length === 0 ? (
        <div className="h-40 flex items-center justify-center text-gray-300 text-sm">{t('analytics.course_analytics.common.no_data')}</div>
      ) : (
        <div className="h-40">
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-2xl font-bold text-gray-900">
              <AnimatedNumber value={totalEvents} />
            </span>
            <span className="text-xs text-gray-400">{t('analytics.course_analytics.units.events')}</span>
          </div>
          <div className="space-y-2">
            {rows.slice(0, 3).map((row: any, i: number) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-gray-600">
                  {getTypeLabel(row.activity_type)}
                </span>
                <div className="flex gap-3 text-xs">
                  <span className="text-gray-500">{row.unique_learners} {t('analytics.course_analytics.units.learners')}</span>
                  <span className="text-emerald-600 font-medium">{row.completions} {t('analytics.course_analytics.units.done')}</span>
                </div>
              </div>
            ))}
          </div>
          {rows.length > 3 && (
            <p className="text-[10px] text-gray-300 text-center mt-2">
              {t('analytics.course_analytics.common.more_expand', { count: rows.length - 3 })}
            </p>
          )}
        </div>
      )}
    </CourseWidgetCard>
  )
}
