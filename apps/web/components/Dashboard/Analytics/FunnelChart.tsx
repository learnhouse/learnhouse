'use client'
import React from 'react'
import { useAnalyticsPipe } from './useAnalyticsDashboard'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

const COLORS = ['#6b8de3', '#818cf8', '#a78bfa', '#c4b5fd']
const kFormatter = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)

export default function FunnelChart({ days = '30' }: { days?: string }) {
  const { data, isLoading } = useAnalyticsPipe('enrollment_funnel', { days })
  const row = data?.data?.[0]

  const stages = row
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
      ) : stages.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-300">No data yet</div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={stages} layout="vertical">
            <XAxis type="number" tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={kFormatter} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#6b7280' }} stroke="#9ca3af" width={100} />
            <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #f3f4f6', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} formatter={(v: number) => v.toLocaleString()} />
            <Bar dataKey="value" name="Count" radius={[0, 4, 4, 0]}>
              {stages.map((_entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
