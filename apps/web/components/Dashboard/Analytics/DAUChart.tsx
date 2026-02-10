'use client'
import React from 'react'
import { useAnalyticsPipe } from './useAnalyticsDashboard'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'

const kFormatter = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v))
const shortDate = (v: string) =>
  new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export default function DAUChart({ days = '30' }: { days?: string }) {
  const { data, isLoading } = useAnalyticsPipe('daily_active_users', { days })
  const rows = data?.data ?? []

  return (
    <div className="bg-white nice-shadow rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Daily Active Users</h3>
      {isLoading ? (
        <div className="h-[260px] flex items-center justify-center text-gray-300">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="h-[260px] flex items-center justify-center text-gray-300">No data yet</div>
      ) : (
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={rows}>
              <defs>
                <linearGradient id="dauGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6b8de3" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#6b8de3" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                stroke="#9ca3af"
                tickFormatter={shortDate}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                stroke="#9ca3af"
                tickFormatter={kFormatter}
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
                labelFormatter={(label) =>
                  new Date(label).toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })
                }
                formatter={(value: number) => [`${value.toLocaleString()}`, 'Users']}
              />
              <Area
                type="monotone"
                dataKey="dau"
                stroke="#6b8de3"
                strokeWidth={2}
                fill="url(#dauGradient)"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
