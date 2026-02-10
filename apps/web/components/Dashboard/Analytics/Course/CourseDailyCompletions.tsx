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
import { CheckCircle } from '@phosphor-icons/react'
import CourseWidgetCard, { WidgetIcon, AnimatedNumber } from './CourseWidgetCard'

const kFormatter = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v))
const shortDate = (v: string) =>
  new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export default function CourseDailyCompletions({
  courseId,
  days = '30',
}: {
  courseId: string
  days?: string
}) {
  const { t } = useTranslation()
  const { data, isLoading } = useCoursePipe('course_daily_completions', courseId, { days })
  const rows = data?.data ?? []

  const totalCompletions = rows.reduce((s: number, r: any) => s + (r.completions || 0), 0)
  const peakDay = Math.max(...rows.map((r: any) => r.completions || 0), 0)
  const avgDaily = rows.length > 0 ? Math.round(totalCompletions / rows.length * 10) / 10 : 0

  const empty = !isLoading && rows.length === 0

  return (
    <CourseWidgetCard
      icon={<WidgetIcon icon={CheckCircle} bg="bg-emerald-50" color="text-emerald-500" weight="fill" />}
      title={t('analytics.course_analytics.daily_completions.title')}
      subtitle={t('analytics.course_analytics.daily_completions.subtitle')}
      modalContent={
        isLoading ? (
          <div className="h-96 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.loading')}</div>
        ) : empty ? (
          <div className="h-96 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.no_data')}</div>
        ) : (
          <div className="space-y-5">
            <div className="flex gap-8">
              <div className="bg-emerald-50 rounded-xl px-5 py-3">
                <p className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold">{t('analytics.course_analytics.common.total')}</p>
                <p className="text-2xl font-bold text-emerald-600">{totalCompletions}</p>
              </div>
              <div className="bg-gray-50 rounded-xl px-5 py-3">
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{t('analytics.course_analytics.common.peak_day')}</p>
                <p className="text-2xl font-bold text-gray-700">{peakDay}</p>
              </div>
              <div className="bg-gray-50 rounded-xl px-5 py-3">
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{t('analytics.course_analytics.common.daily_avg')}</p>
                <p className="text-2xl font-bold text-gray-700">{avgDaily}</p>
              </div>
            </div>
            <div style={{ height: 380 }}>
              <ResponsiveContainer width="100%" height={380}>
                <AreaChart data={rows}>
                  <defs>
                    <linearGradient id="completionsModalGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={shortDate} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={kFormatter} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #f3f4f6', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                  <Area type="monotone" dataKey="completions" stroke="#10b981" strokeWidth={2.5} fill="url(#completionsModalGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
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
            <span className="text-2xl font-bold text-gray-900"><AnimatedNumber value={totalCompletions} /></span>
            <span className="text-xs text-gray-400">{t('analytics.course_analytics.units.total_completions')}</span>
          </div>
          <div style={{ height: 160 }}>
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={rows}>
                <defs>
                  <linearGradient id="completionsMiniGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 9 }} stroke="#9ca3af" tickFormatter={shortDate} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #f3f4f6', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                <Area type="monotone" dataKey="completions" stroke="#10b981" strokeWidth={2} fill="url(#completionsMiniGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </CourseWidgetCard>
  )
}
