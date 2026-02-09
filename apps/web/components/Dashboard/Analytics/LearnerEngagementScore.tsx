'use client'
import React from 'react'
import { useAnalyticsPipe } from './useAnalyticsDashboard'

export default function LearnerEngagementScore({ days = '30' }: { days?: string }) {
  const { data, isLoading } = useAnalyticsPipe('learner_engagement_score', { days })
  const rows = data?.data ?? []

  return (
    <div className="bg-white rounded-xl nice-shadow p-5 min-h-[300px]">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">Learner Engagement Score</h3>
      <p className="text-xs text-gray-400 mb-4">Top learners by composite engagement</p>
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-gray-300">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-300">No data yet</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 text-xs uppercase tracking-wider border-b border-gray-100">
                <th className="pb-2">User ID</th>
                <th className="pb-2 text-right">Score</th>
                <th className="pb-2 text-right">Page Views</th>
                <th className="pb-2 text-right">Activities</th>
                <th className="pb-2 text-right">Courses</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 20).map((r: any, i: number) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-1.5 text-gray-700">{r.user_id}</td>
                  <td className="py-1.5 text-right font-semibold text-indigo-600">{Math.round(r.engagement_score)}</td>
                  <td className="py-1.5 text-right text-gray-500">{r.page_views}</td>
                  <td className="py-1.5 text-right text-gray-500">{r.activities_completed}</td>
                  <td className="py-1.5 text-right text-gray-500">{r.courses_completed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
