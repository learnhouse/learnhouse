'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useCoursePipe } from '../useAnalyticsDashboard'
import { Eye, UserPlus, GraduationCap, TrendUp } from '@phosphor-icons/react'
import { AnimatedNumber, ProgressRing } from './CourseWidgetCard'

function StatCard({
  label,
  value,
  numericValue,
  suffix,
  icon: Icon,
  bgColor,
  ringColor,
  ringPercent,
}: {
  label: string
  value: string | number
  numericValue?: number
  suffix?: string
  icon: React.ElementType
  bgColor: string
  ringColor?: string
  ringPercent?: number
}) {
  return (
    <div className="bg-white rounded-xl nice-shadow p-5 flex items-center gap-4 group hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200">
      <div className={`p-3 rounded-lg ${bgColor}`}>
        <Icon size={20} weight="bold" className="text-white" />
      </div>
      <div className="flex-1">
        <p className="text-xs text-gray-400 font-medium">{label}</p>
        <p className="text-2xl font-bold text-gray-900">
          {numericValue != null ? (
            <AnimatedNumber value={numericValue} suffix={suffix} />
          ) : (
            value
          )}
        </p>
      </div>
      {ringPercent != null && ringColor && (
        <ProgressRing percent={ringPercent} size={44} strokeWidth={4} color={ringColor} />
      )}
    </div>
  )
}

export default function CourseOverviewStats({
  courseId,
  days = '30',
}: {
  courseId: string | number
  days?: string
}) {
  const { t } = useTranslation()
  const { data, isLoading } = useCoursePipe('course_overview_stats', courseId, { days })
  const row = data?.data?.[0]

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl nice-shadow p-5 h-24 animate-pulse" />
        ))}
      </div>
    )
  }

  const completionRate = row?.completion_rate ?? 0

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        label={t('analytics.course_analytics.overview_stats.views')}
        value={row?.views ?? 0}
        numericValue={row?.views ?? 0}
        icon={Eye}
        bgColor="bg-blue-500"
      />
      <StatCard
        label={t('analytics.course_analytics.overview_stats.enrollments')}
        value={row?.enrollments ?? 0}
        numericValue={row?.enrollments ?? 0}
        icon={UserPlus}
        bgColor="bg-indigo-500"
      />
      <StatCard
        label={t('analytics.course_analytics.overview_stats.completions')}
        value={row?.completions ?? 0}
        numericValue={row?.completions ?? 0}
        icon={GraduationCap}
        bgColor="bg-emerald-500"
      />
      <StatCard
        label={t('analytics.course_analytics.overview_stats.completion_rate')}
        value={`${completionRate}%`}
        numericValue={completionRate}
        suffix="%"
        icon={TrendUp}
        bgColor="bg-amber-500"
        ringColor="#f59e0b"
        ringPercent={completionRate}
      />
    </div>
  )
}
