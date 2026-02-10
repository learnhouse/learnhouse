'use client'
import React from 'react'
import { useAnalyticsPipe } from './useAnalyticsDashboard'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'

export default function NewVsReturning({ days = '30' }: { days?: string }) {
  const { data, isLoading } = useAnalyticsPipe('new_vs_returning', { days })
  const rows = data?.data ?? []

  return (
    <div className="bg-white rounded-xl nice-shadow p-5 min-h-[300px] overflow-hidden min-w-0">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">New vs Returning Users</h3>
      <p className="text-xs text-gray-400 mb-4">Growth vs retention health</p>
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-gray-300">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-300">No data yet</div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={rows}>
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="new_users" name="New" stackId="1" fill="#93c5fd" stroke="#60a5fa" />
            <Area type="monotone" dataKey="returning_users" name="Returning" stackId="1" fill="#c4b5fd" stroke="#8b5cf6" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
