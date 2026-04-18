'use client'
import React from 'react'
import { useAnalyticsPipe } from './useAnalyticsDashboard'
import Link from 'next/link'

function getTypeLabel(type: string): string {
  const key = type.replace(/^TYPE_/, '').toLowerCase()
  const labels: Record<string, string> = {
    video: 'Video',
    document: 'Document',
    quiz: 'Quiz',
    assignment: 'Assignment',
    dynamic: 'Dynamic',
    custom: 'Custom',
    scorm: 'SCORM',
  }
  return labels[key] || key.charAt(0).toUpperCase() + key.slice(1)
}

export default function ActivityEngagement({ days = '30' }: { days?: string }) {
  const { data, isLoading } = useAnalyticsPipe('activity_engagement', { days })
  const rawRows = data?.data ?? []
  const merged = new Map<string, any>()
  for (const row of rawRows) {
    const key = row.activity_uuid || row.activity_name
    if (!key) continue
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, { ...row })
    } else {
      existing.views = (existing.views || 0) + (row.views || 0)
      existing.completions = (existing.completions || 0) + (row.completions || 0)
      if (!existing.activity_type && row.activity_type) existing.activity_type = row.activity_type
      if (!existing.course_uuid && row.course_uuid) existing.course_uuid = row.course_uuid
      if (!existing.activity_name && row.activity_name) existing.activity_name = row.activity_name
      if (row.avg_seconds_spent > 0 && (!existing.avg_seconds_spent || existing.avg_seconds_spent <= 0)) {
        existing.avg_seconds_spent = row.avg_seconds_spent
      }
    }
  }
  const rows = Array.from(merged.values())

  return (
    <div className="bg-white rounded-xl nice-shadow p-5 min-h-[300px] overflow-hidden min-w-0">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Activity Engagement</h3>
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-gray-300">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-300">No data yet</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-start text-gray-400 text-xs uppercase tracking-wider border-b border-gray-100">
                <th className="pb-2">Activity</th>
                <th className="pb-2">Type</th>
                <th className="pb-2 text-end">Views</th>
                <th className="pb-2 text-end">Completions</th>
                <th className="pb-2 text-end">Avg Time</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 20).map((row: any, i: number) => {
                const cleanCourseUuid = row.course_uuid ? row.course_uuid.replace('course_', '') : null
                const cleanActivityUuid = row.activity_uuid ? row.activity_uuid.replace('activity_', '') : null
                const href = cleanCourseUuid && cleanActivityUuid
                  ? `/course/${cleanCourseUuid}/activity/${cleanActivityUuid}`
                  : null
                const name = row.activity_name || row.activity_uuid
                return (
                  <tr key={row.activity_uuid} className="border-b border-gray-50">
                    <td className="py-2 font-medium text-gray-700 truncate max-w-[180px]">
                      {href ? (
                        <Link href={href} className="text-blue-600 hover:underline">
                          {name}
                        </Link>
                      ) : (
                        name
                      )}
                    </td>
                    <td className="py-2 text-gray-400 text-xs">{getTypeLabel(row.activity_type)}</td>
                    <td className="py-2 text-end text-gray-500">{row.views}</td>
                    <td className="py-2 text-end text-gray-500">{row.completions}</td>
                    <td className="py-2 text-end text-gray-500">
                      {row.avg_seconds_spent != null && row.avg_seconds_spent > 0 ? `${Math.round(row.avg_seconds_spent)}s` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
