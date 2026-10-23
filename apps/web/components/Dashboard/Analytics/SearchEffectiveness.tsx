'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useAnalyticsPipe } from './useAnalyticsDashboard'

export default function SearchEffectiveness({ days = '30' }: { days?: string }) {
  const { t } = useTranslation()
  const { data, isLoading } = useAnalyticsPipe('search_effectiveness', { days })
  const rows = data?.data ?? []

  return (
    <div className="bg-white rounded-xl nice-shadow p-5 min-h-[300px] overflow-hidden min-w-0">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">{t('dash.analytics.search_effectiveness')}</h3>
      <p className="text-xs text-gray-400 mb-4">{t('dash.analytics.search_effectiveness_sub')}</p>
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-gray-300">{t('dash.analytics.loading')}</div>
      ) : rows.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-300">{t('dash.analytics.no_data_yet')}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 text-xs uppercase tracking-wider border-b border-gray-100">
                <th className="pb-2">{t('dash.analytics.col_query')}</th>
                <th className="pb-2 text-right">{t('dash.analytics.col_searches')}</th>
                <th className="pb-2 text-right">{t('dash.analytics.col_zero_results')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 15).map((r: any, i: number) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-1.5 text-gray-700 truncate max-w-[200px]">{r.query}</td>
                  <td className="py-1.5 text-right text-gray-500">{r.search_count}</td>
                  <td className="py-1.5 text-right text-gray-500">{r.zero_result_rate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
