'use client'
import React from 'react'
import { useAnalyticsPipe } from './useAnalyticsDashboard'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'

export default function ContentTypeEffectiveness({ days = '30' }: { days?: string }) {
  const { data, isLoading } = useAnalyticsPipe('content_type_effectiveness', { days })
  const rows = (data?.data ?? []).map((r: any) => ({
    activity_type: r.activity_type,
    view_count: r.view_count,
    completion_count: r.completion_count,
  }))

  return (
    <div className="bg-white rounded-xl nice-shadow p-5 min-h-[300px] overflow-hidden min-w-0">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">Content Type Effectiveness</h3>
      <p className="text-xs text-gray-400 mb-4">Completion rate by activity type</p>
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-gray-300">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-300">No data yet</div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
            <XAxis dataKey="activity_type" tick={{ fontSize: 10 }} stroke="#9ca3af" />
            <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" />
            <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #f3f4f6', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="view_count" name="Views" fill="#93c5fd" radius={[4, 4, 0, 0]} />
            <Bar dataKey="completion_count" name="Completions" fill="#6366f1" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
