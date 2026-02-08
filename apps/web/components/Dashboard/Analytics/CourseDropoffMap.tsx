'use client'
import React from 'react'
import { useAnalyticsPipe } from './useAnalyticsDashboard'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

export default function CourseDropoffMap({ days = '90' }: { days?: string }) {
  const { data, isLoading } = useAnalyticsPipe('course_dropoff', { days })
  const rows = (data?.data ?? []).slice(0, 15)

  return (
    <div className="bg-white rounded-xl nice-shadow p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">Course Dropoff</h3>
      <p className="text-xs text-gray-400 mb-4">Where users stop per course</p>
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-gray-300">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-300">No data yet</div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={rows}>
            <XAxis dataKey="last_activity_id" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="dropoff_count" fill="#f87171" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
