'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useCoursePipe } from '../useAnalyticsDashboard'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { ArrowsLeftRight } from '@phosphor-icons/react'
import CourseWidgetCard, { WidgetIcon } from './CourseWidgetCard'

export default function CourseViewToEnrollment({
  courseId,
  days = '30',
}: {
  courseId: string | number
  days?: string
}) {
  const { t } = useTranslation()
  const { data, isLoading } = useCoursePipe('course_view_to_enrollment', courseId, { days })
  const rows = data?.data ?? []

  const totalViews = rows.reduce((s: number, r: any) => s + (r.views || 0), 0)
  const totalEnrollments = rows.reduce((s: number, r: any) => s + (r.enrollments || 0), 0)
  const overallRate = totalViews > 0 ? Math.round((totalEnrollments / totalViews) * 1000) / 10 : 0

  const empty = !isLoading && rows.length === 0

  return (
    <CourseWidgetCard
      icon={<WidgetIcon icon={ArrowsLeftRight} bg="bg-sky-50" color="text-sky-500" />}
      title={t('analytics.course_analytics.view_to_enrollment.title')}
      subtitle={t('analytics.course_analytics.view_to_enrollment.subtitle')}
      modalContent={
        isLoading ? (
          <div className="h-96 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.loading')}</div>
        ) : empty ? (
          <div className="h-96 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.no_data')}</div>
        ) : (
          <div className="space-y-5">
            <div className="flex gap-8">
              <div className="bg-indigo-50 rounded-xl px-5 py-3">
                <p className="text-[10px] uppercase tracking-wider text-indigo-400 font-semibold">{t('analytics.course_analytics.common.views')}</p>
                <p className="text-2xl font-bold text-indigo-600">{totalViews}</p>
              </div>
              <div className="bg-emerald-50 rounded-xl px-5 py-3">
                <p className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold">{t('analytics.course_analytics.common.enrollments')}</p>
                <p className="text-2xl font-bold text-emerald-600">{totalEnrollments}</p>
              </div>
              <div className="bg-amber-50 rounded-xl px-5 py-3">
                <p className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">{t('analytics.course_analytics.common.conversion')}</p>
                <p className="text-2xl font-bold text-amber-600">{overallRate}%</p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={380}>
              <AreaChart data={rows}>
                <defs>
                  <linearGradient id="viewsGradM" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.15} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0.01} />
                  </linearGradient>
                  <linearGradient id="enrollsGradM" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.15} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="views" stroke="#6366f1" strokeWidth={2} fill="url(#viewsGradM)" dot={{ r: 2 }} name={t('analytics.course_analytics.common.views')} />
                <Area type="monotone" dataKey="enrollments" stroke="#10b981" strokeWidth={2} fill="url(#enrollsGradM)" dot={{ r: 2 }} name={t('analytics.course_analytics.common.enrollments')} />
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
              <span className="text-2xl font-bold text-gray-900">{overallRate}%</span>
              <span className="text-xs text-gray-400">{t('analytics.course_analytics.units.conversion')}</span>
            </div>
            <div className="flex gap-3 text-xs">
              <span className="text-indigo-500 font-medium">{totalViews} {t('analytics.course_analytics.units.views')}</span>
              <span className="text-emerald-500 font-medium">{totalEnrollments} {t('analytics.course_analytics.units.enrolled')}</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={rows}>
              <defs>
                <linearGradient id="viewsGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.12} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0.01} />
                </linearGradient>
                <linearGradient id="enrollsGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.12} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip contentStyle={{ borderRadius: 10, border: 'none', boxShadow: '0 4px 15px rgba(0,0,0,0.08)', fontSize: 12 }} />
              <Area type="monotone" dataKey="views" stroke="#6366f1" strokeWidth={1.5} fill="url(#viewsGrad)" dot={false} name={t('analytics.course_analytics.common.views')} />
              <Area type="monotone" dataKey="enrollments" stroke="#10b981" strokeWidth={1.5} fill="url(#enrollsGrad)" dot={false} name={t('analytics.course_analytics.common.enrollments')} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </CourseWidgetCard>
  )
}
