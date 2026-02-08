'use client'
import React from 'react'
import { useAnalyticsPipe } from './useAnalyticsDashboard'
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

export default function CourseEffectivenessMatrix({ days = '90' }: { days?: string }) {
  const { data, isLoading } = useAnalyticsPipe('course_rating_by_completion', { days })
  const rows = (data?.data ?? []).map((r: any) => ({
    ...r,
    activity_count: Number(r.activity_count),
    completion_rate: Number(r.completion_rate),
    enrollments: Number(r.enrollments),
  }))

  return (
    <div className="bg-white rounded-xl nice-shadow p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">Course Effectiveness Matrix</h3>
      <p className="text-xs text-gray-400 mb-4">Activity count vs completion rate (sized by enrollments)</p>
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-gray-300">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-300">No data yet</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="activity_count" name="Activities" tick={{ fontSize: 11 }} />
            <YAxis dataKey="completion_rate" name="Completion %" unit="%" tick={{ fontSize: 11 }} />
            <ZAxis dataKey="enrollments" range={[30, 300]} name="Enrollments" />
            <Tooltip cursor={{ strokeDasharray: '3 3' }} />
            <Scatter data={rows} fill="#8b5cf6" />
          </ScatterChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
