'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useCoursePipe } from '../useAnalyticsDashboard'
import { Cube } from '@phosphor-icons/react'
import CourseWidgetCard, { WidgetIcon } from './CourseWidgetCard'

const TYPE_COLORS: Record<string, string> = {
  video: 'bg-blue-500',
  document: 'bg-amber-500',
  quiz: 'bg-purple-500',
  assignment: 'bg-rose-500',
  dynamic: 'bg-teal-500',
  custom: 'bg-gray-500',
  scorm: 'bg-cyan-500',
}

const TYPE_HEX: Record<string, string> = {
  video: '#3b82f6',
  document: '#f59e0b',
  quiz: '#8b5cf6',
  assignment: '#f43f5e',
  dynamic: '#14b8a6',
  custom: '#6b7280',
  scorm: '#06b6d4',
}

function getColor(type: string) {
  const key = type.replace(/^TYPE_/, '').toLowerCase()
  return TYPE_COLORS[key] || 'bg-gray-400'
}

export default function CourseActivityTypeBreakdown({
  courseId,
  days = '30',
}: {
  courseId: string | number
  days?: string
}) {
  const { t } = useTranslation()
  const getTypeLabel = (type: string) => {
    const key = type.replace(/^TYPE_/, '').toLowerCase()
    const label = t('analytics.course_analytics.type_labels.' + key)
    return label.startsWith('analytics.') ? key.charAt(0).toUpperCase() + key.slice(1) : label
  }
  const { data, isLoading } = useCoursePipe('course_activity_type_breakdown', courseId, { days })
  const rows = data?.data ?? []
  const totalViews = rows.reduce((s: number, r: any) => s + (r.views || 0), 0)

  return (
    <CourseWidgetCard
      icon={<WidgetIcon icon={Cube} bg="bg-teal-50" color="text-teal-500" />}
      title={t('analytics.course_analytics.activity_type_breakdown.title')}
      subtitle={t('analytics.course_analytics.activity_type_breakdown.subtitle')}
      modalContent={
        isLoading ? (
          <div className="h-80 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.loading')}</div>
        ) : rows.length === 0 ? (
          <div className="h-80 flex items-center justify-center text-gray-300">{t('analytics.course_analytics.common.no_data')}</div>
        ) : (
          <div className="space-y-6">
            {/* Large proportion bar */}
            <div className="flex rounded-full overflow-hidden h-8">
              {rows.map((row: any, i: number) => {
                const pct = totalViews > 0 ? (row.views / totalViews) * 100 : 0
                if (pct < 1) return null
                return (
                  <div
                    key={i}
                    className={`${getColor(row.activity_type)} transition-all flex items-center justify-center`}
                    style={{ width: `${pct}%` }}
                  >
                    {pct > 10 && (
                      <span className="text-white text-xs font-medium">{Math.round(pct)}%</span>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Detail table */}
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                  <th className="pb-2 font-medium">{t('analytics.course_analytics.common.type')}</th>
                  <th className="pb-2 font-medium text-right">{t('analytics.course_analytics.common.views')}</th>
                  <th className="pb-2 font-medium text-right">{t('analytics.course_analytics.common.completions')}</th>
                  <th className="pb-2 font-medium text-right">{t('analytics.course_analytics.common.rate')}</th>
                  <th className="pb-2 font-medium text-right">{t('analytics.course_analytics.common.pct_of_total')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row: any, i: number) => {
                  const pct = totalViews > 0 ? Math.round((row.views / totalViews) * 100) : 0
                  return (
                    <tr key={i} className="border-b border-gray-50 last:border-0">
                      <td className="py-2.5 font-medium text-gray-700 flex items-center gap-2">
                        <div className={`w-3 h-3 rounded-sm ${getColor(row.activity_type)}`} />
                        {getTypeLabel(row.activity_type)}
                      </td>
                      <td className="py-2.5 text-right text-gray-600">{row.views}</td>
                      <td className="py-2.5 text-right text-emerald-600 font-medium">{row.completions}</td>
                      <td className="py-2.5 text-right text-gray-500">{row.completion_rate}%</td>
                      <td className="py-2.5 text-right text-gray-400">{pct}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      }
    >
      {isLoading ? (
        <div className="h-40 flex items-center justify-center text-gray-300 text-sm">{t('analytics.course_analytics.common.loading')}</div>
      ) : rows.length === 0 ? (
        <div className="h-40 flex items-center justify-center text-gray-300 text-sm">{t('analytics.course_analytics.common.no_data')}</div>
      ) : (
        <div className="h-40">
          {/* Mini proportion bar */}
          <div className="flex rounded-full overflow-hidden h-5 mb-4">
            {rows.map((row: any, i: number) => {
              const pct = totalViews > 0 ? (row.views / totalViews) * 100 : 0
              if (pct < 1) return null
              return (
                <div
                  key={i}
                  className={`${getColor(row.activity_type)} transition-all`}
                  style={{ width: `${pct}%` }}
                  title={`${getTypeLabel(row.activity_type)}: ${Math.round(pct)}%`}
                />
              )
            })}
          </div>

          {/* Summary */}
          <div className="space-y-1.5">
            {rows.slice(0, 4).map((row: any, i: number) => {
              const pct = totalViews > 0 ? Math.round((row.views / totalViews) * 100) : 0
              return (
                <div key={i} className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-sm shrink-0 ${getColor(row.activity_type)}`} />
                  <span className="text-xs text-gray-600 flex-1">
                    {getTypeLabel(row.activity_type)}
                  </span>
                  <span className="text-xs text-gray-400">{pct}%</span>
                  <span className="text-[10px] text-emerald-500">{row.completion_rate}% {t('analytics.course_analytics.units.done')}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </CourseWidgetCard>
  )
}
