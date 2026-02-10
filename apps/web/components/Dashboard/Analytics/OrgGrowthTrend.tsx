'use client'
import React from 'react'
import { useAnalyticsPipe } from './useAnalyticsDashboard'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'

export default function OrgGrowthTrend({ days = '90' }: { days?: string }) {
  const { data, isLoading } = useAnalyticsPipe('org_growth_trend', { days })
  const rows = data?.data ?? []

  const chartRows = rows.map((r: any) => ({
    week: r.week?.slice(5, 10),
    signups: r.signups,
    enrollments: r.enrollments,
    completions: r.completions,
  }))

  return (
    <div className="bg-white rounded-xl nice-shadow p-5 min-h-[300px] overflow-hidden min-w-0">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">Org Growth Trend</h3>
      <p className="text-xs text-gray-400 mb-4">Weekly signups, enrollments, completions</p>
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-gray-300">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-300">No data yet</div>
      ) : (
        <div style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartRows}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis
                dataKey="week"
                tick={{ fontSize: 11 }}
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
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line
                type="monotone"
                dataKey="signups"
                stroke="#60a5fa"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="enrollments"
                stroke="#8b5cf6"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="completions"
                stroke="#10b981"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
