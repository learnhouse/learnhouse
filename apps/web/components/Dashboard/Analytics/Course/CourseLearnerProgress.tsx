'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useCoursePipe } from '../useAnalyticsDashboard'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer } from 'recharts'
import { ChartBar } from '@phosphor-icons/react'
import CourseWidgetCard, { WidgetIcon, AnimatedNumber } from './CourseWidgetCard'

const BAR_COLORS = ['#c4b5fd', '#a78bfa', '#8b5cf6', '#7c3aed', '#6d28d9', '#5b21b6']

function kFormatter(v: number) {
  return v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)
}

export default function CourseLearnerProgress({
  courseId,
  days = '90',
}: {
  courseId: string
  days?: string
}) {
  const { t } = useTranslation()
  const { data, isLoading } = useCoursePipe('course_learner_progress', courseId, { days })
  const rows = data?.data ?? []

  const totalLearners = rows.reduce((s: number, r: any) => s + (r.user_count || 0), 0)

  const empty = !isLoading && rows.length === 0

  const chartRows = rows.map((r: any, i: number) => ({
    bracket: r.bracket,
    user_count: r.user_count,
    color: BAR_COLORS[i % BAR_COLORS.length],
  }))

  const MiniChart = () => (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={chartRows}>
        <XAxis dataKey="bracket" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #f3f4f6', fontSize: 13 }} />
        <Bar dataKey="user_count" name={t('analytics.course_analytics.units.learners')} radius={[4, 4, 0, 0]}>
          {chartRows.map((entry: any, i: number) => (
            <Cell key={i} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )

  const ModalChart = () => (
    <ResponsiveContainer width="100%" height={380}>
      <BarChart data={chartRows}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
        <XAxis dataKey="bracket" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={kFormatter} />
        <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #f3f4f6', fontSize: 13 }} />
        <Bar dataKey="user_count" name={t('analytics.course_analytics.units.learners')} radius={[6, 6, 0, 0]}>
          {chartRows.map((entry: any, i: number) => (
            <Cell key={i} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )

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
            <ModalChart />
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
          <MiniChart />
        </div>
      )}
    </CourseWidgetCard>
  )
}
