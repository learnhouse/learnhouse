'use client'
import React from 'react'
import { useAnalyticsPipe } from './useAnalyticsDashboard'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

export default function CommunityCorrelation({ days = '90' }: { days?: string }) {
  const { data, isLoading } = useAnalyticsPipe('community_correlation', { days })
  const rows = data?.data ?? []

  const chartData = rows.map((r: any) => ({
    name: r.group_name === 'discussors' ? 'Discussion Users' : 'Non-Discussion Users',
    completion_rate: r.completion_rate,
  }))

  return (
    <div className="bg-white rounded-xl nice-shadow p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">Community Correlation</h3>
      <p className="text-xs text-gray-400 mb-4">Completion rate: discussors vs non-discussors</p>
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-gray-300">Loading...</div>
      ) : chartData.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-300">No data yet</div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData}>
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} unit="%" />
            <Tooltip />
            <Bar dataKey="completion_rate" fill="#6366f1" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
