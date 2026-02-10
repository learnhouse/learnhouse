'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useCoursePipe } from '../useAnalyticsDashboard'
import { Timer } from '@phosphor-icons/react'
import CourseWidgetCard, { WidgetIcon, ProgressRing } from './CourseWidgetCard'

export default function CourseTimeToCompletion({
  courseId,
  days = '180',
}: {
  courseId: string
  days?: string
}) {
  const { t } = useTranslation()
  const { data, isLoading } = useCoursePipe('course_time_to_completion', courseId, { days })
  const row = data?.data?.[0]

  const median = Math.round(row?.median_days || 0)
  const p25 = Math.round(row?.p25_days || 0)
  const p75 = Math.round(row?.p75_days || 0)
  const count = row?.completions_count || 0

  return (
    <CourseWidgetCard
      icon={<WidgetIcon icon={Timer} bg="bg-blue-50" color="text-blue-500" weight="fill" />}
      title={t('analytics.course_analytics.time_to_completion.title')}
      subtitle={t('analytics.course_analytics.time_to_completion.subtitle')}
      modalContent={
        isLoading ? (
          <div className="h-60 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.loading')}</div>
        ) : !row ? (
          <div className="h-60 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.no_data')}</div>
        ) : (
          <div className="space-y-8 py-6">
            <div className="text-center">
              <div className="inline-flex items-center gap-3 bg-blue-50 rounded-2xl px-8 py-5">
                <Timer size={32} weight="fill" className="text-blue-500" />
                <div>
                  <p className="text-5xl font-black text-gray-900">{median}</p>
                  <p className="text-sm text-gray-500 mt-1">{t('analytics.course_analytics.time_to_completion.median_days_to_complete')}</p>
                </div>
              </div>
            </div>
            <div className="flex justify-center gap-4">
              <div className="text-center px-5 py-4 bg-blue-50 rounded-xl flex-1 max-w-[160px]">
                <p className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">{t('analytics.course_analytics.time_to_completion.fast_p25')}</p>
                <p className="text-2xl font-bold text-blue-600 mt-1">{p25} {t('analytics.course_analytics.time_to_completion.days_unit')}</p>
                <p className="text-[10px] text-gray-400 mt-1">{t('analytics.course_analytics.time_to_completion.top_25_finish')}</p>
              </div>
              <div className="text-center px-5 py-4 bg-gray-100 rounded-xl flex-1 max-w-[160px]">
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{t('analytics.course_analytics.time_to_completion.median')}</p>
                <p className="text-2xl font-bold text-gray-700 mt-1">{median} {t('analytics.course_analytics.time_to_completion.days_unit')}</p>
                <p className="text-[10px] text-gray-400 mt-1">{t('analytics.course_analytics.time_to_completion.half_finish')}</p>
              </div>
              <div className="text-center px-5 py-4 bg-amber-50 rounded-xl flex-1 max-w-[160px]">
                <p className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">{t('analytics.course_analytics.time_to_completion.slow_p75')}</p>
                <p className="text-2xl font-bold text-amber-600 mt-1">{p75} {t('analytics.course_analytics.time_to_completion.days_unit')}</p>
                <p className="text-[10px] text-gray-400 mt-1">{t('analytics.course_analytics.time_to_completion.pct_75_finish')}</p>
              </div>
            </div>
            <p className="text-sm text-center text-gray-400">
              {t('analytics.course_analytics.time_to_completion.based_on', { count })}
            </p>
          </div>
        )
      }
    >
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-gray-300 text-sm">{t('analytics.course_analytics.common.loading')}</div>
      ) : !row ? (
        <div className="h-48 flex items-center justify-center text-gray-300 text-sm">{t('analytics.course_analytics.common.no_data')}</div>
      ) : (
        <div className="flex items-center justify-center h-48 gap-5">
          <ProgressRing
            percent={p75 > 0 ? Math.min((median / p75) * 100, 100) : 50}
            size={80}
            strokeWidth={6}
            color="#3b82f6"
          />
          <div>
            <p className="text-4xl font-black text-gray-900">{median}</p>
            <p className="text-sm text-gray-500">{t('analytics.course_analytics.units.median_days')}</p>
            <div className="flex gap-3 mt-2 text-[10px]">
              <span className="bg-blue-50 text-blue-500 px-2 py-0.5 rounded-full font-medium">P25: {p25}d</span>
              <span className="bg-amber-50 text-amber-500 px-2 py-0.5 rounded-full font-medium">P75: {p75}d</span>
            </div>
          </div>
        </div>
      )}
    </CourseWidgetCard>
  )
}
