'use client'
import React from 'react'
import { useAnalyticsPipe } from './useAnalyticsDashboard'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'

export default function UserProgressSnapshot({ days = '90' }: { days?: string }) {
  const { data, isLoading } = useAnalyticsPipe('user_progress_snapshot', { days })
  const rows: any[] = data?.data ?? []

  // Group by course_id, with brackets as sub-bars
  const courseMap = new Map<string, any>()
  for (const r of rows) {
    if (!courseMap.has(r.course_id)) courseMap.set(r.course_id, { course_id: r.course_id })
    courseMap.get(r.course_id)[r.bracket] = r.user_count
  }
  const chartData = Array.from(courseMap.values()).slice(0, 10)

  const BRACKETS = ['0%', '1-25%', '26-50%', '51-75%', '76-100%']
  const COLORS = ['#e5e7eb', '#c4b5fd', '#a78bfa', '#8b5cf6', '#6d28d9']

  return (
    <div className="bg-white rounded-xl nice-shadow p-5 min-h-[300px]">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">User Progress Snapshot</h3>
      <p className="text-xs text-gray-400 mb-4">Users at each completion bracket per course</p>
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-gray-300">Loading...</div>
      ) : chartData.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-300">No data yet</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData}>
            <XAxis dataKey="course_id" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {BRACKETS.map((b, i) => (
              <Bar key={b} dataKey={b} stackId="a" fill={COLORS[i]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
