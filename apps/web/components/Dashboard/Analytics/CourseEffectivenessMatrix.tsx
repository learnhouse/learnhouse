'use client'
import React from 'react'
import { useAnalyticsPipe } from './useAnalyticsDashboard'
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis } from 'recharts'

export default function CourseEffectivenessMatrix({ days = '90' }: { days?: string }) {
  const { data, isLoading } = useAnalyticsPipe('course_rating_by_completion', { days })
  const rows = (data?.data ?? []).map((r: any) => ({
    ...r,
    activity_count: Number(r.activity_count),
    completion_rate: Number(r.completion_rate),
    enrollments: Number(r.enrollments),
    z: Math.max(40, Math.min(400, r.enrollments * 4)),
  }))

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null
    const d = payload[0].payload
    return (
      <div style={{ borderRadius: 12, border: '1px solid #f3f4f6', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', background: '#fff', padding: 12 }}>
        <p style={{ fontSize: 11, color: '#6b7280', margin: 0 }}>Activities: {d.activity_count}</p>
        <p style={{ fontSize: 13, fontWeight: 'bold', color: '#111827', margin: 0 }}>Completion: {d.completion_rate}%</p>
        <p style={{ fontSize: 11, color: '#6b7280', margin: 0 }}>Enrollments: {d.enrollments}</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl nice-shadow p-5 min-h-[300px] overflow-hidden min-w-0">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">Course Effectiveness Matrix</h3>
      <p className="text-xs text-gray-400 mb-4">Activity count vs completion rate (sized by enrollments)</p>
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-gray-300">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-300">No data yet</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis dataKey="activity_count" name="Activities" tick={{ fontSize: 11 }} stroke="#9ca3af" label={{ value: 'Activities', position: 'insideBottom', offset: -5, fontSize: 11 }} />
            <YAxis dataKey="completion_rate" name="Completion %" tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={(v: number) => `${v}%`} label={{ value: 'Completion %', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <ZAxis dataKey="z" range={[40, 400]} />
            <Tooltip content={<CustomTooltip />} />
            <Scatter data={rows} fill="rgba(139, 92, 246, 0.6)" stroke="#8b5cf6" strokeWidth={1} />
          </ScatterChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
