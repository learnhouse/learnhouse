'use client'
import React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@components/ui/dialog'
import { useAnalyticsDetail } from './useAnalyticsDashboard'
import {
  Broadcast,
  UserPlus,
  GraduationCap,
  CheckCircle,
} from '@phosphor-icons/react'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function UserAvatar({ user }: { user?: any }) {
  if (!user) return <div className="w-7 h-7 rounded-full bg-gray-200 flex-shrink-0" />
  if (user.avatar_image) {
    return (
      <img
        src={user.avatar_image}
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

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatDate(ts: string): string {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function stripCoursePrefix(uuid: string): string {
  return uuid?.replace(/^course_/, '') || ''
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-12 text-gray-400 text-sm">
      Loading...
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center py-12 text-gray-400 text-sm">
      No data yet
    </div>
  )
}

// ---------------------------------------------------------------------------
// Modal wrapper
// ---------------------------------------------------------------------------

export function AnalyticsDetailModal({
  open,
  onOpenChange,
  title,
  description,
  icon,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {icon}
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto flex-1 -mx-6 px-6 pb-6">{children}</div>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Live Users Detail
// ---------------------------------------------------------------------------

export function LiveUsersDetail({ days }: { days: string }) {
  const { data, isLoading } = useAnalyticsDetail('detail_live_users', {}, 30000)
  const rows = data?.data ?? []
  const users = data?.users ?? {}

  if (isLoading) return <LoadingState />
  if (rows.length === 0) return <EmptyState />

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
          <th className="pb-2 font-medium">User</th>
          <th className="pb-2 font-medium">Current Page</th>
          <th className="pb-2 font-medium">Device</th>
          <th className="pb-2 font-medium">Country</th>
          <th className="pb-2 font-medium text-right">Last Seen</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row: any, i: number) => {
          const user = users[row.user_id]
          return (
            <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
              <td className="py-2.5">
                <a
                  href="/dash/users/settings/users"
                  className="flex items-center gap-2 hover:underline"
                >
                  <UserAvatar user={user} />
                  <span className="text-gray-700 font-medium truncate max-w-[140px]">
                    {userName(user)}
                  </span>
                </a>
              </td>
              <td className="py-2.5">
                {row.path ? (
                  <a
                    href={row.path}
                    className="text-blue-600 hover:underline truncate max-w-[200px] block"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {row.path}
                  </a>
                ) : (
                  <span className="text-gray-300">—</span>
                )}
              </td>
              <td className="py-2.5 text-gray-500 capitalize">{row.device_type || '—'}</td>
              <td className="py-2.5">
                {row.country_code ? (
                  <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-mono">
                    {row.country_code}
                  </span>
                ) : (
                  <span className="text-gray-300">—</span>
                )}
              </td>
              <td className="py-2.5 text-right text-gray-400 text-xs">
                {relativeTime(row.last_seen)}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ---------------------------------------------------------------------------
// Signups Detail
// ---------------------------------------------------------------------------

export function SignupsDetail({ days }: { days: string }) {
  const { data, isLoading } = useAnalyticsDetail('detail_signups', { days })
  const rows = data?.data ?? []
  const users = data?.users ?? {}

  if (isLoading) return <LoadingState />
  if (rows.length === 0) return <EmptyState />

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
          <th className="pb-2 font-medium">User</th>
          <th className="pb-2 font-medium">Email</th>
          <th className="pb-2 font-medium">Method</th>
          <th className="pb-2 font-medium text-right">Date</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row: any, i: number) => {
          const user = users[row.user_id]
          return (
            <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
              <td className="py-2.5">
                <a
                  href="/dash/users/settings/users"
                  className="flex items-center gap-2 hover:underline"
                >
                  <UserAvatar user={user} />
                  <span className="text-gray-700 font-medium truncate max-w-[140px]">
                    {userName(user)}
                  </span>
                </a>
              </td>
              <td className="py-2.5 text-gray-500 truncate max-w-[180px]">
                {user?.email || '—'}
              </td>
              <td className="py-2.5">
                {row.signup_method ? (
                  <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded capitalize">
                    {row.signup_method}
                  </span>
                ) : (
                  <span className="text-gray-300">—</span>
                )}
              </td>
              <td className="py-2.5 text-right text-gray-400 text-xs">
                {formatDate(row.timestamp)}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ---------------------------------------------------------------------------
// Enrollments Detail
// ---------------------------------------------------------------------------

export function EnrollmentsDetail({ days }: { days: string }) {
  const { data, isLoading } = useAnalyticsDetail('detail_enrollments', { days })
  const rows = data?.data ?? []
  const users = data?.users ?? {}

  if (isLoading) return <LoadingState />
  if (rows.length === 0) return <EmptyState />

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
          <th className="pb-2 font-medium">User</th>
          <th className="pb-2 font-medium">Course</th>
          <th className="pb-2 font-medium text-right">Date</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row: any, i: number) => {
          const user = users[row.user_id]
          const courseLink = row.course_uuid
            ? `/dash/courses/course/${stripCoursePrefix(row.course_uuid)}/general`
            : null
          return (
            <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
              <td className="py-2.5">
                <a
                  href="/dash/users/settings/users"
                  className="flex items-center gap-2 hover:underline"
                >
                  <UserAvatar user={user} />
                  <span className="text-gray-700 font-medium truncate max-w-[140px]">
                    {userName(user)}
                  </span>
                </a>
              </td>
              <td className="py-2.5">
                {courseLink ? (
                  <a href={courseLink} className="text-blue-600 hover:underline truncate max-w-[200px] block">
                    {row.course_name || row.course_id}
                  </a>
                ) : (
                  <span className="text-gray-500">{row.course_name || row.course_id || '—'}</span>
                )}
              </td>
              <td className="py-2.5 text-right text-gray-400 text-xs">
                {formatDate(row.timestamp)}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ---------------------------------------------------------------------------
// Completions Detail
// ---------------------------------------------------------------------------

export function CompletionsDetail({ days }: { days: string }) {
  const { data, isLoading } = useAnalyticsDetail('detail_completions', { days })
  const rows = data?.data ?? []
  const users = data?.users ?? {}

  if (isLoading) return <LoadingState />
  if (rows.length === 0) return <EmptyState />

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
          <th className="pb-2 font-medium">User</th>
          <th className="pb-2 font-medium">Course</th>
          <th className="pb-2 font-medium text-right">Date</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row: any, i: number) => {
          const user = users[row.user_id]
          const courseLink = row.course_uuid
            ? `/dash/courses/course/${stripCoursePrefix(row.course_uuid)}/general`
            : null
          return (
            <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
              <td className="py-2.5">
                <a
                  href="/dash/users/settings/users"
                  className="flex items-center gap-2 hover:underline"
                >
                  <UserAvatar user={user} />
                  <span className="text-gray-700 font-medium truncate max-w-[140px]">
                    {userName(user)}
                  </span>
                </a>
              </td>
              <td className="py-2.5">
                {courseLink ? (
                  <a href={courseLink} className="text-blue-600 hover:underline truncate max-w-[200px] block">
                    {row.course_name || row.course_id}
                  </a>
                ) : (
                  <span className="text-gray-500">{row.course_name || row.course_id || '—'}</span>
                )}
              </td>
              <td className="py-2.5 text-right text-gray-400 text-xs">
                {formatDate(row.timestamp)}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
