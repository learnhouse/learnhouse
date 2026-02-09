'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useCoursePipe } from '../useAnalyticsDashboard'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Area, AreaChart } from 'recharts'
import { TrendUp } from '@phosphor-icons/react'
import CourseWidgetCard, { WidgetIcon, AnimatedNumber } from './CourseWidgetCard'

export default function CourseEnrollmentTrend({
  courseId,
  days = '30',
}: {
  courseId: string | number
  days?: string
}) {
  const { t } = useTranslation()
  const { data, isLoading } = useCoursePipe('course_enrollment_trend', courseId, { days })
  const rows = data?.data ?? []

  const totalEnrollments = rows.reduce((s: number, r: any) => s + (r.enrollments || 0), 0)
  const latestDay = rows.length > 0 ? rows[rows.length - 1]?.enrollments || 0 : 0
  const avgDaily = rows.length > 0 ? Math.round(totalEnrollments / rows.length * 10) / 10 : 0

  const empty = !isLoading && rows.length === 0
  const loading = isLoading

  return (
    <CourseWidgetCard
      icon={<WidgetIcon icon={TrendUp} bg="bg-indigo-50" color="text-indigo-500" />}
      title={t('analytics.course_analytics.enrollment_trend.title')}
      subtitle={t('analytics.course_analytics.enrollment_trend.subtitle')}
      modalContent={
        loading ? (
          <div className="h-96 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.loading')}</div>
        ) : empty ? (
          <div className="h-96 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.no_data')}</div>
        ) : (
          <div className="space-y-5">
            <div className="flex gap-8">
              <div className="bg-indigo-50 rounded-xl px-5 py-3">
                <p className="text-[10px] uppercase tracking-wider text-indigo-400 font-semibold">{t('analytics.course_analytics.common.total')}</p>
                <p className="text-2xl font-bold text-indigo-600">{totalEnrollments}</p>
              </div>
              <div className="bg-gray-50 rounded-xl px-5 py-3">
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{t('analytics.course_analytics.common.daily_avg')}</p>
                <p className="text-2xl font-bold text-gray-700">{avgDaily}</p>
              </div>
              <div className="bg-gray-50 rounded-xl px-5 py-3">
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{t('analytics.course_analytics.common.latest_day')}</p>
                <p className="text-2xl font-bold text-gray-700">{latestDay}</p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={380}>
              <AreaChart data={rows}>
                <defs>
                  <linearGradient id="enrollGradM" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} />
                <Area type="monotone" dataKey="enrollments" stroke="#6366f1" strokeWidth={2.5} fill="url(#enrollGradM)" dot={{ r: 3, fill: '#6366f1', strokeWidth: 0 }} activeDot={{ r: 6, fill: '#6366f1', stroke: '#fff', strokeWidth: 2 }} name={t('analytics.course_analytics.common.enrollments')} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )
      }
    >
      {loading ? (
        <div className="h-48 flex items-center justify-center text-gray-300 text-sm">{t('analytics.course_analytics.common.loading')}</div>
      ) : empty ? (
        <div className="h-48 flex items-center justify-center text-gray-300 text-sm">{t('analytics.course_analytics.common.no_data')}</div>
      ) : (
        <div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-2xl font-bold text-gray-900"><AnimatedNumber value={totalEnrollments} /></span>
            <span className="text-xs text-gray-400">{t('analytics.course_analytics.units.total')}</span>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={rows}>
              <defs>
                <linearGradient id="enrollGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip contentStyle={{ borderRadius: 10, border: 'none', boxShadow: '0 4px 15px rgba(0,0,0,0.08)', fontSize: 12 }} />
              <Area type="monotone" dataKey="enrollments" stroke="#6366f1" strokeWidth={2} fill="url(#enrollGrad)" dot={false} name={t('analytics.course_analytics.common.enrollments')} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </CourseWidgetCard>
  )
}
