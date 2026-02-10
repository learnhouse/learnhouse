'use client'
import React from 'react'
import { useAnalyticsDetail } from './useAnalyticsDashboard'
import { getUserAvatarMediaDirectory } from '@services/media/media'

function getAvatarUrl(user: any): string | null {
  if (!user?.avatar_image) return null
  const url = user.avatar_image
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  if (user.user_uuid) return getUserAvatarMediaDirectory(user.user_uuid, url)
  return null
}

function UserAvatarSmall({ user }: { user?: any }) {
  if (!user) return <div className="w-7 h-7 rounded-full bg-gray-200 flex-shrink-0" />
  const avatarUrl = getAvatarUrl(user)
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className="w-7 h-7 rounded-full object-cover flex-shrink-0"
      />
    )
  }
  const initials = `${(user.first_name?.[0] || '').toUpperCase()}${(user.last_name?.[0] || '').toUpperCase()}` || user.username?.[0]?.toUpperCase() || '?'
  return (
    <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-600 text-xs font-medium flex items-center justify-center flex-shrink-0">
      {initials}
    </div>
  )
}

function userName(user?: any): string {
  if (!user) return 'Unknown'
  if (user.first_name || user.last_name) return `${user.first_name || ''} ${user.last_name || ''}`.trim()
  return user.username || 'Unknown'
}

function formatTime(seconds: number): string {
  if (!seconds || seconds <= 0) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

export default function LearnerEngagementScore({ days = '30' }: { days?: string }) {
  const { data, isLoading } = useAnalyticsDetail('learner_engagement_score', { days })
  const rows = data?.data ?? []
  const users: Record<number, any> = data?.users ?? {}

  return (
    <div className="bg-white rounded-xl nice-shadow p-5 min-h-[300px] overflow-hidden min-w-0">
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
                <th className="pb-2">Learner</th>
                <th className="pb-2 text-right">Score</th>
                <th className="pb-2 text-right">Pages</th>
                <th className="pb-2 text-right">Activities</th>
                <th className="pb-2 text-right">Courses</th>
                <th className="pb-2 text-right">Time</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 20).map((r: any, i: number) => {
                const user = users[r.user_id]
                return (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="py-2">
                      <a
                        href="/dash/users/settings/users"
                        className="flex items-center gap-2 hover:underline"
                      >
                        <UserAvatarSmall user={user} />
                        <span className="text-gray-700 font-medium truncate max-w-[140px]">
                          {userName(user)}
                        </span>
                      </a>
                    </td>
                    <td className="py-1.5 text-right font-semibold text-indigo-600">{Math.round(r.engagement_score)}</td>
                    <td className="py-1.5 text-right text-gray-500">{r.page_views}</td>
                    <td className="py-1.5 text-right text-gray-500">{r.activities_completed}</td>
                    <td className="py-1.5 text-right text-gray-500">{r.courses_completed}</td>
                    <td className="py-1.5 text-right text-gray-500">{formatTime(r.total_time_spent)}</td>
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
