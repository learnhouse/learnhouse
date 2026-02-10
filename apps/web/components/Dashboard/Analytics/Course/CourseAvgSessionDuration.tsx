'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useCoursePipe } from '../useAnalyticsDashboard'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { ClockCountdown } from '@phosphor-icons/react'
import CourseWidgetCard, { WidgetIcon } from './CourseWidgetCard'

function formatSeconds(seconds: number): string {
  if (!seconds || seconds <= 0) return '0s'
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function shortDate(v: string) {
  const d = new Date(v)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function CourseAvgSessionDuration({
  courseId,
  days = '30',
}: {
  courseId: string
  days?: string
}) {
  const { t } = useTranslation()
  const { data, isLoading } = useCoursePipe('course_avg_session_duration', courseId, { days })
  const rows = (data?.data ?? []).map((r: any) => ({
    ...r,
    minutes: Math.round((r.avg_seconds_per_user || 0) / 60 * 10) / 10,
    shortDate: shortDate(r.date),
  }))

  const totalSeconds = rows.reduce((s: number, r: any) => s + (r.total_seconds || 0), 0)
  const avgMinutes = rows.length > 0
    ? Math.round(rows.reduce((s: number, r: any) => s + (r.minutes || 0), 0) / rows.length * 10) / 10
    : 0

  const empty = !isLoading && rows.length === 0

  const MiniChart = () => (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={rows}>
        <XAxis dataKey="shortDate" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
        <Tooltip
          formatter={(value: number) => [`${value} min ${t('analytics.course_analytics.units.avg_per_learner')}`, '']}
          contentStyle={{ borderRadius: 12, border: '1px solid #f3f4f6', fontSize: 13 }}
        />
        <Bar dataKey="minutes" name={t('analytics.course_analytics.avg_session_duration.minutes_label')} fill="#8b5cf6" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )

  const ModalChart = () => (
    <ResponsiveContainer width="100%" height={380}>
      <BarChart data={rows}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
        <XAxis dataKey="shortDate" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          label={{ value: t('analytics.course_analytics.avg_session_duration.minutes_label'), angle: -90, position: 'insideLeft', fontSize: 10 }}
        />
        <Tooltip
          formatter={(value: number) => [`${value} min ${t('analytics.course_analytics.units.avg_per_learner')}`, '']}
          contentStyle={{ borderRadius: 12, border: '1px solid #f3f4f6', fontSize: 13 }}
        />
        <Bar dataKey="minutes" name={t('analytics.course_analytics.avg_session_duration.minutes_label')} fill="#8b5cf6" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )

  return (
    <CourseWidgetCard
      icon={<WidgetIcon icon={ClockCountdown} bg="bg-purple-50" color="text-purple-500" />}
      title={t('analytics.course_analytics.avg_session_duration.title')}
      subtitle={t('analytics.course_analytics.avg_session_duration.subtitle')}
      modalContent={
        isLoading ? (
          <div className="h-96 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.loading')}</div>
        ) : empty ? (
          <div className="h-96 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.no_data')}</div>
        ) : (
          <div className="space-y-5">
            <div className="flex gap-8">
              <div className="bg-purple-50 rounded-xl px-5 py-3">
                <p className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">{t('analytics.course_analytics.avg_session_duration.total_time')}</p>
                <p className="text-2xl font-bold text-purple-600">{formatSeconds(totalSeconds)}</p>
              </div>
              <div className="bg-gray-50 rounded-xl px-5 py-3">
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{t('analytics.course_analytics.avg_session_duration.avg_per_day')}</p>
                <p className="text-2xl font-bold text-gray-700">{avgMinutes}m</p>
              </div>
            </div>
            <ModalChart />
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
              <span className="text-2xl font-bold text-gray-900">{avgMinutes}m</span>
              <span className="text-xs text-gray-400">{t('analytics.course_analytics.units.avg_per_day')}</span>
            </div>
            <span className="text-xs text-purple-400">{formatSeconds(totalSeconds)} {t('analytics.course_analytics.units.total')}</span>
          </div>
          <MiniChart />
        </div>
      )}
    </CourseWidgetCard>
  )
}
