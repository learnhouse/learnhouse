'use client'
import React from 'react'
import { useAnalyticsPipe } from './useAnalyticsDashboard'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

export default function CourseDropoffMap({ days = '90' }: { days?: string }) {
  const { data, isLoading } = useAnalyticsPipe('course_dropoff', { days })
  const rows = (data?.data ?? []).slice(0, 15).map((r: any) => ({
    ...r,
    label: r.last_activity_name || r.course_name || 'Unknown',
  }))

  return (
    <div className="bg-white rounded-xl nice-shadow p-5 min-h-[300px] overflow-hidden min-w-0">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">Course Dropoff</h3>
      <p className="text-xs text-gray-400 mb-4">Where users stop per course</p>
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-gray-300">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-300">No data yet</div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#9ca3af" />
            <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" allowDecimals={false} />
            <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #f3f4f6', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
            <Bar dataKey="dropoff_count" name="Dropoff Count" fill="#f87171" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
