'use client'
import React from 'react'
import { useAnalyticsPipe } from './useAnalyticsDashboard'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { useTranslation } from 'react-i18next'

export default function ContentTypeEffectiveness({ days = '30' }: { days?: string }) {
  const { t } = useTranslation()
  const { data, isLoading } = useAnalyticsPipe('content_type_effectiveness', { days })
  const rows = (data?.data ?? []).map((r: any) => ({
    activity_type: r.activity_type,
    view_count: r.view_count,
    completion_count: r.completion_count,
  }))

  return (
    <div className="bg-white rounded-xl nice-shadow p-5 min-h-[300px] overflow-hidden min-w-0">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">{t('dash.analytics.content_type_effectiveness')}</h3>
      <p className="text-xs text-gray-400 mb-4">{t('dash.analytics.content_type_effectiveness_sub')}</p>
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-gray-300">{t('dash.analytics.loading')}</div>
      ) : rows.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-300">{t('dash.analytics.no_data_yet')}</div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
            <XAxis dataKey="activity_type" tick={{ fontSize: 10 }} stroke="#9ca3af" />
            <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" />
            <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #f3f4f6', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="view_count" name={t('dash.analytics.views')} fill="#93c5fd" radius={[4, 4, 0, 0]} />
            <Bar dataKey="completion_count" name={t('dash.analytics.completions')} fill="#6366f1" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
