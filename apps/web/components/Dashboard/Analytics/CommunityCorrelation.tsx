'use client'
import React from 'react'
import { useAnalyticsPipe } from './useAnalyticsDashboard'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useTranslation } from 'react-i18next'

export default function CommunityCorrelation({ days = '90' }: { days?: string }) {
  const { t } = useTranslation()
  const { data, isLoading } = useAnalyticsPipe('community_correlation', { days })
  const rows = data?.data ?? []

  const chartRows = rows.map((r: any) => ({
    name: r.group_name === 'discussors' ? t('analytics.advanced_widgets.community_correlation.discussion_users') : t('analytics.advanced_widgets.community_correlation.non_discussion_users'),
    completion_rate: r.completion_rate,
  }))

  return (
    <div className="bg-white rounded-xl nice-shadow p-5 min-h-[300px] overflow-hidden min-w-0">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">{t('analytics.advanced_widgets.community_correlation.title')}</h3>
      <p className="text-xs text-gray-400 mb-4">{t('analytics.advanced_widgets.community_correlation.description')}</p>
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-gray-300">{t('analytics.common.loading')}</div>
      ) : chartRows.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-300">{t('analytics.common.no_data')}</div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartRows}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#9ca3af" />
            <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={(v: number) => `${v}%`} />
            <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #f3f4f6', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} formatter={(v = 0) => `${v}%`} />
            <Bar dataKey="completion_rate" name={t('analytics.advanced_widgets.community_correlation.completion_rate')} fill="#6366f1" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
