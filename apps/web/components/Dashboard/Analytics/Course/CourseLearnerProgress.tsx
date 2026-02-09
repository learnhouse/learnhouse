'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useCoursePipe } from '../useAnalyticsDashboard'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts'
import { ChartBar } from '@phosphor-icons/react'
import CourseWidgetCard, { WidgetIcon, AnimatedNumber } from './CourseWidgetCard'

const BAR_COLORS = ['#c4b5fd', '#a78bfa', '#8b5cf6', '#7c3aed', '#6d28d9', '#5b21b6']

export default function CourseLearnerProgress({
  courseId,
  days = '90',
}: {
  courseId: string | number
  days?: string
}) {
  const { t } = useTranslation()
  const { data, isLoading } = useCoursePipe('course_learner_progress', courseId, { days })
  const rows = data?.data ?? []

  const totalLearners = rows.reduce((s: number, r: any) => s + (r.user_count || 0), 0)

  const empty = !isLoading && rows.length === 0

  return (
    <CourseWidgetCard
      icon={<WidgetIcon icon={ChartBar} bg="bg-purple-50" color="text-purple-500" />}
      title={t('analytics.course_analytics.learner_progress.title')}
      subtitle={t('analytics.course_analytics.learner_progress.subtitle')}
      modalContent={
        isLoading ? (
          <div className="h-96 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.loading')}</div>
        ) : empty ? (
          <div className="h-96 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.no_data')}</div>
        ) : (
          <div className="space-y-5">
            <p className="text-sm text-gray-500">{t('analytics.course_analytics.learner_progress.total_across_brackets', { count: totalLearners })}</p>
            <ResponsiveContainer width="100%" height={380}>
              <BarChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="bracket" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} />
                <Bar dataKey="user_count" radius={[6, 6, 0, 0]} name={t('analytics.course_analytics.units.learners')}>
                  {rows.map((_: any, i: number) => (
                    <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-4">
              {rows.map((row: any, i: number) => (
                <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }} />
                  <span className="text-sm text-gray-600">{row.bracket}</span>
                  <span className="text-sm font-bold text-gray-900">{row.user_count}</span>
                </div>
              ))}
            </div>
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
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-2xl font-bold text-gray-900"><AnimatedNumber value={totalLearners} /></span>
            <span className="text-xs text-gray-400">{t('analytics.course_analytics.units.learners')}</span>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={rows}>
              <XAxis dataKey="bracket" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip contentStyle={{ borderRadius: 10, border: 'none', boxShadow: '0 4px 15px rgba(0,0,0,0.08)', fontSize: 12 }} />
              <Bar dataKey="user_count" radius={[4, 4, 0, 0]} name={t('analytics.course_analytics.units.learners')}>
                {rows.map((_: any, i: number) => (
                  <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </CourseWidgetCard>
  )
}
