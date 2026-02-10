'use client'
import React from 'react'
import { useAnalyticsPipe } from './useAnalyticsDashboard'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

const COLORS = ['#6b8de3', '#818cf8', '#a78bfa', '#c4b5fd']

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white nice-shadow rounded-lg px-3 py-2 text-sm">
      <p className="text-gray-500 text-xs mb-0.5">{payload[0].payload.name}</p>
      <p className="text-gray-900 font-bold">{payload[0].value.toLocaleString()}</p>
    </div>
  )
}

export default function FunnelChart({ days = '30' }: { days?: string }) {
  const { data, isLoading } = useAnalyticsPipe('enrollment_funnel', { days })
  const row = data?.data?.[0]

  const chartData = row
    ? [
        { name: 'Page Views', value: row.page_views },
        { name: 'Course Views', value: row.course_views },
        { name: 'Enrollments', value: row.enrollments },
        { name: 'Completions', value: row.completions },
      ]
    : []

  return (
    <div className="bg-white rounded-xl nice-shadow p-5 overflow-hidden min-w-0">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Enrollment Funnel</h3>
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-gray-300">Loading...</div>
      ) : chartData.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-300">No data yet</div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} layout="vertical" barCategoryGap="20%">
            <XAxis
              type="number"
              tick={{ fontSize: 11, fill: '#9ca3af' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v)}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 11, fill: '#6b7280' }}
              width={100}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f9fafb' }} />
            <Bar dataKey="value" radius={[0, 6, 6, 0]}>
              {chartData.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
