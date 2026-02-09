'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useCoursePipe } from '../useAnalyticsDashboard'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { CheckCircle } from '@phosphor-icons/react'
import CourseWidgetCard, { WidgetIcon, AnimatedNumber } from './CourseWidgetCard'

export default function CourseDailyCompletions({
  courseId,
  days = '30',
}: {
  courseId: string | number
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
            <ResponsiveContainer width="100%" height={380}>
              <AreaChart data={rows}>
                <defs>
                  <linearGradient id="compGradM" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} />
                <Area type="monotone" dataKey="completions" stroke="#10b981" strokeWidth={2.5} fill="url(#compGradM)" dot={{ r: 3, fill: '#10b981', strokeWidth: 0 }} activeDot={{ r: 6 }} name={t('analytics.course_analytics.common.completions')} />
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
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-2xl font-bold text-gray-900"><AnimatedNumber value={totalCompletions} /></span>
            <span className="text-xs text-gray-400">{t('analytics.course_analytics.units.total_completions')}</span>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={rows}>
              <defs>
                <linearGradient id="compGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip contentStyle={{ borderRadius: 10, border: 'none', boxShadow: '0 4px 15px rgba(0,0,0,0.08)', fontSize: 12 }} />
              <Area type="monotone" dataKey="completions" stroke="#10b981" strokeWidth={2} fill="url(#compGrad)" dot={false} name={t('analytics.course_analytics.common.completions')} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </CourseWidgetCard>
  )
}
