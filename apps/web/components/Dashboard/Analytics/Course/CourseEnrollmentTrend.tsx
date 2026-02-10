'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useCoursePipe } from '../useAnalyticsDashboard'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import { TrendUp } from '@phosphor-icons/react'
import CourseWidgetCard, { WidgetIcon, AnimatedNumber } from './CourseWidgetCard'

const kFormatter = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v))
const shortDate = (v: string) =>
  new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export default function CourseEnrollmentTrend({
  courseId,
  days = '30',
}: {
  courseId: string
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
            <div style={{ height: 380 }}>
              <ResponsiveContainer width="100%" height={380}>
                <AreaChart data={rows}>
                  <defs>
                    <linearGradient id="enrollModalGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={shortDate} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={kFormatter} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #f3f4f6', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                  <Area type="monotone" dataKey="enrollments" stroke="#6366f1" strokeWidth={2.5} fill="url(#enrollModalGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
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
          <div style={{ height: 160 }}>
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={rows}>
                <defs>
                  <linearGradient id="enrollMiniGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 9 }} stroke="#9ca3af" tickFormatter={shortDate} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #f3f4f6', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                <Area type="monotone" dataKey="enrollments" stroke="#6366f1" strokeWidth={2} fill="url(#enrollMiniGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </CourseWidgetCard>
  )
}
