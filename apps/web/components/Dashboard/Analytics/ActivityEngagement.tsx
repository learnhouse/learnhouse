'use client'
import React from 'react'
import { useAnalyticsPipe } from './useAnalyticsDashboard'

export default function ActivityEngagement({ days = '30' }: { days?: string }) {
  const { data, isLoading } = useAnalyticsPipe('activity_engagement', { days })
  const rows = data?.data ?? []

  return (
    <div className="bg-white rounded-xl nice-shadow p-5 min-h-[300px]">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Activity Engagement</h3>
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-gray-300">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-300">No data yet</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 text-xs uppercase tracking-wider border-b border-gray-100">
                <th className="pb-2">Activity</th>
                <th className="pb-2">Type</th>
                <th className="pb-2 text-right">Views</th>
                <th className="pb-2 text-right">Completions</th>
                <th className="pb-2 text-right">Avg Time</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 20).map((row: any, i: number) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-2 font-medium text-gray-700 truncate max-w-[180px]">{row.activity_id}</td>
                  <td className="py-2 text-gray-400 text-xs">{row.activity_type}</td>
                  <td className="py-2 text-right text-gray-500">{row.views}</td>
                  <td className="py-2 text-right text-gray-500">{row.completions}</td>
                  <td className="py-2 text-right text-gray-500">
                    {row.avg_seconds_spent ? `${Math.round(row.avg_seconds_spent)}s` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
