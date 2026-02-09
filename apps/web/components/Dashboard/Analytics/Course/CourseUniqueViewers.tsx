'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useCoursePipe } from '../useAnalyticsDashboard'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { Binoculars } from '@phosphor-icons/react'
import CourseWidgetCard, { WidgetIcon, AnimatedNumber } from './CourseWidgetCard'

export default function CourseUniqueViewers({
  courseId,
  days = '30',
}: {
  courseId: string | number
  days?: string
}) {
  const { t } = useTranslation()
  const { data, isLoading } = useCoursePipe('course_unique_viewers', courseId, { days })
  const rows = data?.data ?? []

  const totalViews = rows.reduce((s: number, r: any) => s + (r.total_views || 0), 0)
  const peakViewers = Math.max(...rows.map((r: any) => r.unique_viewers || 0), 0)

  const empty = !isLoading && rows.length === 0

  return (
    <CourseWidgetCard
      icon={<WidgetIcon icon={Binoculars} bg="bg-sky-50" color="text-sky-500" />}
      title={t('analytics.course_analytics.unique_viewers.title')}
      subtitle={t('analytics.course_analytics.unique_viewers.subtitle')}
      modalContent={
        isLoading ? (
          <div className="h-96 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.loading')}</div>
        ) : empty ? (
          <div className="h-96 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.no_data')}</div>
        ) : (
          <div className="space-y-5">
            <div className="flex gap-8">
              <div className="bg-sky-50 rounded-xl px-5 py-3">
                <p className="text-[10px] uppercase tracking-wider text-sky-400 font-semibold">{t('analytics.course_analytics.unique_viewers.total_views')}</p>
                <p className="text-2xl font-bold text-sky-600">{totalViews}</p>
              </div>
              <div className="bg-gray-50 rounded-xl px-5 py-3">
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{t('analytics.course_analytics.unique_viewers.peak_viewers')}</p>
                <p className="text-2xl font-bold text-gray-700">{peakViewers}</p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={380}>
              <AreaChart data={rows}>
                <defs>
                  <linearGradient id="viewersGradM" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} />
                <Area type="monotone" dataKey="unique_viewers" stroke="#0ea5e9" strokeWidth={2.5} fill="url(#viewersGradM)" dot={{ r: 3, fill: '#0ea5e9', strokeWidth: 0 }} activeDot={{ r: 6, fill: '#0ea5e9', stroke: '#fff', strokeWidth: 2 }} name={t('analytics.course_analytics.unique_viewers.title')} />
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
            <span className="text-2xl font-bold text-gray-900"><AnimatedNumber value={totalViews} /></span>
            <span className="text-xs text-gray-400">{t('analytics.course_analytics.units.total_views')}</span>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={rows}>
              <defs>
                <linearGradient id="viewersGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip contentStyle={{ borderRadius: 10, border: 'none', boxShadow: '0 4px 15px rgba(0,0,0,0.08)', fontSize: 12 }} />
              <Area type="monotone" dataKey="unique_viewers" stroke="#0ea5e9" strokeWidth={2} fill="url(#viewersGrad)" dot={false} name={t('analytics.course_analytics.unique_viewers.title')} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </CourseWidgetCard>
  )
}
