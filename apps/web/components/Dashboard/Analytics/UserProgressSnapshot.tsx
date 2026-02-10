'use client'
import React from 'react'
import { useAnalyticsPipe } from './useAnalyticsDashboard'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'

const BRACKETS = ['0%', '1-25%', '26-50%', '51-75%', '76-100%']
const COLORS = ['#e5e7eb', '#c4b5fd', '#a78bfa', '#8b5cf6', '#6d28d9']

export default function UserProgressSnapshot({ days = '90' }: { days?: string }) {
  const { data, isLoading } = useAnalyticsPipe('user_progress_snapshot', { days })
  const rows: any[] = data?.data ?? []

  // Group by course_uuid, with brackets as sub-bars
  const courseMap = new Map<string, any>()
  for (const r of rows) {
    if (!courseMap.has(r.course_uuid)) courseMap.set(r.course_uuid, { course_uuid: r.course_uuid, label: r.course_name || r.course_uuid })
    courseMap.get(r.course_uuid)[r.bracket] = r.user_count
  }
  const chartRows = Array.from(courseMap.values()).slice(0, 10)

  return (
    <div className="bg-white rounded-xl nice-shadow p-5 min-h-[300px] overflow-hidden min-w-0">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">User Progress Snapshot</h3>
      <p className="text-xs text-gray-400 mb-4">Users at each completion bracket per course</p>
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-gray-300">Loading...</div>
      ) : chartRows.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-300">No data yet</div>
      ) : (
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartRows}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10 }}
                stroke="#9ca3af"
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                stroke="#9ca3af"
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 12,
                  border: '1px solid #f3f4f6',
                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                }}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {BRACKETS.map((b, i) => (
                <Bar
                  key={b}
                  dataKey={b}
                  name={b}
                  stackId="a"
                  fill={COLORS[i]}
                  radius={i === BRACKETS.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
