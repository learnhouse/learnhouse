'use client'
import React from 'react'
import { useAnalyticsPipe } from './useAnalyticsDashboard'
import { useTranslation } from 'react-i18next'

export default function CohortRetention({ days = '90' }: { days?: string }) {
  const { t } = useTranslation()
  const { data, isLoading } = useAnalyticsPipe('cohort_retention', { days })
  const rows = data?.data ?? []

  const pct = (val: number, total: number) =>
    total > 0 ? `${Math.round((val / total) * 100)}%` : t('analytics.common.not_available')

  const cellColor = (val: number, total: number) => {
    if (total === 0) return ''
    const p = val / total
    if (p >= 0.5) return 'bg-indigo-100 text-indigo-800'
    if (p >= 0.25) return 'bg-indigo-50 text-indigo-600'
    return 'text-gray-500'
  }

  return (
    <div className="bg-white rounded-xl nice-shadow p-5 min-h-[300px] overflow-hidden min-w-0">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">{t('analytics.advanced_widgets.cohort_retention.title')}</h3>
      <p className="text-xs text-gray-400 mb-4">{t('analytics.advanced_widgets.cohort_retention.description')}</p>
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-gray-300">{t('analytics.common.loading')}</div>
      ) : rows.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-300">{t('analytics.common.no_data')}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 uppercase tracking-wider border-b border-gray-100">
                <th className="pb-2 text-left">{t('analytics.advanced_widgets.cohort_retention.cohort')}</th>
                <th className="pb-2">{t('analytics.advanced_widgets.cohort_retention.size')}</th>
                <th className="pb-2">{t('analytics.advanced_widgets.cohort_retention.week_1')}</th>
                <th className="pb-2">{t('analytics.advanced_widgets.cohort_retention.week_2')}</th>
                <th className="pb-2">{t('analytics.advanced_widgets.cohort_retention.week_4')}</th>
                <th className="pb-2">{t('analytics.advanced_widgets.cohort_retention.week_8')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any, i: number) => (
                <tr key={i} className="border-b border-gray-50 text-center">
                  <td className="py-1.5 text-left text-gray-600">{r.cohort_week?.slice(0, 10)}</td>
                  <td className="py-1.5 font-medium">{r.cohort_size}</td>
                  <td className={`py-1.5 ${cellColor(r.week_1, r.cohort_size)}`}>{pct(r.week_1, r.cohort_size)}</td>
                  <td className={`py-1.5 ${cellColor(r.week_2, r.cohort_size)}`}>{pct(r.week_2, r.cohort_size)}</td>
                  <td className={`py-1.5 ${cellColor(r.week_4, r.cohort_size)}`}>{pct(r.week_4, r.cohort_size)}</td>
                  <td className={`py-1.5 ${cellColor(r.week_8, r.cohort_size)}`}>{pct(r.week_8, r.cohort_size)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
