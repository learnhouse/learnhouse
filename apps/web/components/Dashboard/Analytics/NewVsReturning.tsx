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
  Legend,
} from 'recharts'

export default function NewVsReturning({ days = '30' }: { days?: string }) {
  const { data, isLoading } = useAnalyticsPipe('new_vs_returning', { days })
  const rows = data?.data ?? []

  const chartRows = rows.map((r: any) => ({
    date: r.date?.slice(5),
    new_users: r.new_users,
    returning_users: r.returning_users,
  }))

  return (
    <div className="bg-white rounded-xl nice-shadow p-5 min-h-[300px] overflow-hidden min-w-0">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">New vs Returning Users</h3>
      <p className="text-xs text-gray-400 mb-4">Growth vs retention health</p>
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-gray-300">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-300">No data yet</div>
      ) : (
        <div style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartRows} stackOffset="none">
              <defs>
                <linearGradient id="newUsersGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="retUsersGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis
                dataKey="date"
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
              <Area
                type="monotone"
                dataKey="new_users"
                name="New"
                stroke="#60a5fa"
                strokeWidth={2}
                fill="url(#newUsersGrad)"
                stackId="1"
                dot={false}
              />
              <Area
                type="monotone"
                dataKey="returning_users"
                name="Returning"
                stroke="#8b5cf6"
                strokeWidth={2}
                fill="url(#retUsersGrad)"
                stackId="1"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
