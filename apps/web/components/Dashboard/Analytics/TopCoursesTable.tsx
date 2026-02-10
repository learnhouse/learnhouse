'use client'
import React from 'react'
import { useAnalyticsPipe } from './useAnalyticsDashboard'

export default function TopCoursesTable({ days = '30' }: { days?: string }) {
  const { data, isLoading } = useAnalyticsPipe('top_courses', { days })
  const rows = data?.data ?? []

  return (
    <div className="bg-white rounded-xl nice-shadow p-5 overflow-hidden min-w-0">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Top Courses</h3>
      {isLoading ? (
        <div className="h-32 flex items-center justify-center text-gray-300">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="h-32 flex items-center justify-center text-gray-300">No data yet</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 text-xs uppercase tracking-wider border-b border-gray-100">
                <th className="pb-2">Course</th>
                <th className="pb-2 text-right">Views</th>
                <th className="pb-2 text-right">Enrollments</th>
                <th className="pb-2 text-right">Completions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row: any, i: number) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-2 font-medium text-gray-700 truncate max-w-[200px]">
                    {row.course_name || row.course_uuid}
                  </td>
                  <td className="py-2 text-right text-gray-500">{row.views}</td>
                  <td className="py-2 text-right text-gray-500">{row.enrollments}</td>
                  <td className="py-2 text-right text-gray-500">{row.completions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
