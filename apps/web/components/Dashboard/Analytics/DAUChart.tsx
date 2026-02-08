'use client'
import React from 'react'
import { useAnalyticsPipe } from './useAnalyticsDashboard'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const date = new Date(label)
  const formatted = date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  return (
    <div className="bg-white nice-shadow rounded-lg px-3 py-2 text-sm">
      <p className="text-gray-500 text-xs mb-1">{formatted}</p>
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-blue-400" />
        <span className="text-gray-700 font-medium">Users</span>
        <span className="text-gray-900 font-bold ml-auto">{payload[0].value.toLocaleString()}</span>
      </div>
    </div>
  )
}

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
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={rows}>
            <defs>
              <linearGradient id="dauGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#93b5fd" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#93b5fd" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: '#9ca3af' }}
              tickFormatter={(v) => {
                const d = new Date(v)
                return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#9ca3af' }}
              allowDecimals={false}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v)}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#d1d5db', strokeWidth: 1 }} />
            <Area
              type="monotone"
              dataKey="dau"
              stroke="#6b8de3"
              strokeWidth={2}
              fill="url(#dauGradient)"
              dot={false}
              activeDot={{ r: 4, fill: '#6b8de3', stroke: '#fff', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
