'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useCoursePipe } from '../useAnalyticsDashboard'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { UsersFour } from '@phosphor-icons/react'
import CourseWidgetCard, { WidgetIcon, AnimatedNumber } from './CourseWidgetCard'

export default function CourseLearnerRetention({
  courseId,
  days = '90',
}: {
  courseId: string | number
  days?: string
}) {
  const { t } = useTranslation()
  const { data, isLoading } = useCoursePipe('course_learner_retention', courseId, { days })
  const rows = data?.data ?? []

  const cohortSize = rows[0]?.cohort_size || 0
  const chartData = rows.map((row: any) => ({
    day: row.days_since_start,
    retention: cohortSize > 0 ? Math.round((row.active_users / cohortSize) * 100) : 0,
    active: row.active_users,
  }))

  const latestRetention = chartData.length > 1 ? chartData[chartData.length - 1]?.retention || 0 : 0

  const empty = !isLoading && chartData.length === 0

  return (
    <CourseWidgetCard
      icon={<WidgetIcon icon={UsersFour} bg="bg-indigo-50" color="text-indigo-500" />}
      title={t('analytics.course_analytics.learner_retention.title')}
      subtitle={t('analytics.course_analytics.learner_retention.subtitle')}
      modalContent={
        isLoading ? (
          <div className="h-96 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.loading')}</div>
        ) : empty ? (
          <div className="h-96 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.no_data')}</div>
        ) : (
          <div className="space-y-5">
            <div className="flex gap-8">
              <div className="bg-indigo-50 rounded-xl px-5 py-3">
                <p className="text-[10px] uppercase tracking-wider text-indigo-400 font-semibold">{t('analytics.course_analytics.learner_retention.cohort_size')}</p>
                <p className="text-2xl font-bold text-indigo-600">{cohortSize}</p>
              </div>
              <div className="bg-gray-50 rounded-xl px-5 py-3">
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{t('analytics.course_analytics.learner_retention.current_retention')}</p>
                <p className="text-2xl font-bold text-gray-700">{latestRetention}%</p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={380}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="retGradM" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11 }}
                  label={{ value: t('analytics.course_analytics.learner_retention.days_since_first'), position: 'insideBottom', offset: -2, fontSize: 10 }}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  domain={[0, 100]}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}
                  formatter={(value: any) => [`${value}%`, t('analytics.course_analytics.units.retention')]}
                  labelFormatter={(label: any) => t('analytics.course_analytics.learner_retention.day_label', { day: label })}
                />
                <Area type="monotone" dataKey="retention" stroke="#6366f1" strokeWidth={2.5} fill="url(#retGradM)" dot={{ r: 3, fill: '#6366f1', strokeWidth: 0 }} activeDot={{ r: 6 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )
      }
    >
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-gray-300 text-sm">{t('analytics.course_analytics.common.loading')}</div>
      ) : empty ? (
        <div className="h-48 flex items-center justify-center text-gray-300 text-sm">{t('analytics.course_analytics.common.no_data')}</div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-gray-900"><AnimatedNumber value={latestRetention} suffix="%" /></span>
              <span className="text-xs text-gray-400">{t('analytics.course_analytics.units.retention')}</span>
            </div>
            <span className="text-xs text-indigo-400">{cohortSize} {t('analytics.course_analytics.units.in_cohort')}</span>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="retGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="day" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis hide domain={[0, 100]} />
              <Tooltip
                contentStyle={{ borderRadius: 10, border: 'none', boxShadow: '0 4px 15px rgba(0,0,0,0.08)', fontSize: 12 }}
                formatter={(value: any) => [`${value}%`, t('analytics.course_analytics.units.retention')]}
                labelFormatter={(label: any) => t('analytics.course_analytics.learner_retention.day_label', { day: label })}
              />
              <Area type="monotone" dataKey="retention" stroke="#6366f1" strokeWidth={2} fill="url(#retGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </CourseWidgetCard>
  )
}
