'use client'
import React from 'react'
import { useAnalyticsPipe } from './useAnalyticsDashboard'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'

export default function OrgGrowthTrend({ days = '90' }: { days?: string }) {
  const { data, isLoading } = useAnalyticsPipe('org_growth_trend', { days })
  const rows = data?.data ?? []

  return (
    <div className="bg-white rounded-xl nice-shadow p-5 min-h-[300px]">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">Org Growth Trend</h3>
      <p className="text-xs text-gray-400 mb-4">Weekly signups, enrollments, completions</p>
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-gray-300">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-300">No data yet</div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={rows}>
            <XAxis dataKey="week" tick={{ fontSize: 11 }} tickFormatter={(v) => v?.slice(5, 10)} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="signups" stroke="#60a5fa" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="enrollments" stroke="#8b5cf6" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="completions" stroke="#10b981" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
