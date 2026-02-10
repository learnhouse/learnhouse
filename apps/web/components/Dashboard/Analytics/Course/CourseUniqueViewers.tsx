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
import { Binoculars } from '@phosphor-icons/react'
import CourseWidgetCard, { WidgetIcon, AnimatedNumber } from './CourseWidgetCard'

const kFormatter = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v))
const shortDate = (v: string) =>
  new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export default function CourseUniqueViewers({
  courseId,
  days = '30',
}: {
  courseId: string
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
            <div style={{ height: 380 }}>
              <ResponsiveContainer width="100%" height={380}>
                <AreaChart data={rows}>
                  <defs>
                    <linearGradient id="viewersModalGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={shortDate} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={kFormatter} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #f3f4f6', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                  <Area type="monotone" dataKey="unique_viewers" stroke="#0ea5e9" strokeWidth={2.5} fill="url(#viewersModalGrad)" dot={false} />
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
            <span className="text-2xl font-bold text-gray-900"><AnimatedNumber value={totalViews} /></span>
            <span className="text-xs text-gray-400">{t('analytics.course_analytics.units.total_views')}</span>
          </div>
          <div style={{ height: 160 }}>
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={rows}>
                <defs>
                  <linearGradient id="viewersMiniGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 9 }} stroke="#9ca3af" tickFormatter={shortDate} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #f3f4f6', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                <Area type="monotone" dataKey="unique_viewers" stroke="#0ea5e9" strokeWidth={2} fill="url(#viewersMiniGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </CourseWidgetCard>
  )
}
