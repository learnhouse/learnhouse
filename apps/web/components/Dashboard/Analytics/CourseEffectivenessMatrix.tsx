'use client'
import React from 'react'
import { useAnalyticsPipe } from './useAnalyticsDashboard'
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis } from 'recharts'
import { useTranslation } from 'react-i18next'

function MatrixTooltip({ active, payload }: any) {
  const { t } = useTranslation()
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={{ borderRadius: 12, border: '1px solid #f3f4f6', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', background: '#fff', padding: 12 }}>
      <p style={{ fontSize: 11, color: '#6b7280', margin: 0 }}>{t('analytics.advanced_widgets.course_effectiveness_matrix.tooltip_activities', { count: d.activity_count })}</p>
      <p style={{ fontSize: 13, fontWeight: 'bold', color: '#111827', margin: 0 }}>{t('analytics.advanced_widgets.course_effectiveness_matrix.tooltip_completion', { rate: d.completion_rate })}</p>
      <p style={{ fontSize: 11, color: '#6b7280', margin: 0 }}>{t('analytics.advanced_widgets.course_effectiveness_matrix.tooltip_enrollments', { count: d.enrollments })}</p>
    </div>
  )
}

export default function CourseEffectivenessMatrix({ days = '90' }: { days?: string }) {
  const { t } = useTranslation()
  const { data, isLoading } = useAnalyticsPipe('course_rating_by_completion', { days })
  const rows = (data?.data ?? []).map((r: any) => ({
    ...r,
    activity_count: Number(r.activity_count),
    completion_rate: Number(r.completion_rate),
    enrollments: Number(r.enrollments),
    z: Math.max(40, Math.min(400, r.enrollments * 4)),
  }))

  return (
    <div className="bg-white rounded-xl nice-shadow p-5 min-h-[300px] overflow-hidden min-w-0">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">{t('analytics.advanced_widgets.course_effectiveness_matrix.title')}</h3>
      <p className="text-xs text-gray-400 mb-4">{t('analytics.advanced_widgets.course_effectiveness_matrix.description')}</p>
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-gray-300">{t('analytics.common.loading')}</div>
      ) : rows.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-300">{t('analytics.common.no_data')}</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis dataKey="activity_count" name={t('analytics.overview.activities')} tick={{ fontSize: 11 }} stroke="#9ca3af" label={{ value: t('analytics.overview.activities'), position: 'insideBottom', offset: -5, fontSize: 11 }} />
            <YAxis dataKey="completion_rate" name={t('analytics.advanced_widgets.course_effectiveness_matrix.completion_pct')} tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={(v: number) => `${v}%`} label={{ value: t('analytics.advanced_widgets.course_effectiveness_matrix.completion_pct'), angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <ZAxis dataKey="z" range={[40, 400]} />
            <Tooltip content={<MatrixTooltip />} />
            <Scatter data={rows} fill="rgba(139, 92, 246, 0.6)" stroke="#8b5cf6" strokeWidth={1} />
          </ScatterChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
