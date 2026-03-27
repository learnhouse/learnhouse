'use client'
import React, { useMemo } from 'react'
import { Video, ExternalLink, Clock, Radio, CalendarCheck, CalendarX } from 'lucide-react'
import { RRule } from 'rrule'

interface LiveSessionProps {
  activity: any
  course: any
}

function getProviderLabel(provider: string): string {
  switch (provider) {
    case 'zoom':
      return 'Zoom'
    case 'google_meet':
      return 'Google Meet'
    case 'teams':
      return 'Microsoft Teams'
    default:
      return 'Meeting'
  }
}

function getProviderColor(provider: string): string {
  switch (provider) {
    case 'zoom':
      return 'bg-blue-500'
    case 'google_meet':
      return 'bg-green-500'
    case 'teams':
      return 'bg-purple-600'
    default:
      return 'bg-gray-500'
  }
}

type SessionStatus = 'upcoming' | 'live' | 'ended' | 'series_ended'

function LiveSession({ activity }: LiveSessionProps) {
  const content = activity.content
  const schedule = content?.schedule
  const provider = content?.provider || 'other'
  const url = content?.url || ''

  const { status, nextOccurrence, countdown } = useMemo(() => {
    if (!schedule) {
      return { status: 'ended' as SessionStatus, nextOccurrence: null, countdown: '' }
    }

    const now = new Date()
    const start = new Date(schedule.start_datetime)
    const end = new Date(schedule.end_datetime)
    const durationMs = end.getTime() - start.getTime()

    if (!schedule.recurrence) {
      // One-off session
      if (now < start) {
        return {
          status: 'upcoming' as SessionStatus,
          nextOccurrence: start,
          countdown: formatCountdown(start, now),
        }
      } else if (now >= start && now <= end) {
        return { status: 'live' as SessionStatus, nextOccurrence: start, countdown: '' }
      } else {
        return { status: 'ended' as SessionStatus, nextOccurrence: null, countdown: '' }
      }
    }

    // Recurring session
    try {
      const rule = RRule.fromString(
        `DTSTART:${toRRuleDateString(start)}\nRRULE:${schedule.recurrence.rule}`
      )

      // Check if recurrence has ended
      if (schedule.recurrence.end_date) {
        const recurrenceEnd = new Date(schedule.recurrence.end_date)
        if (now > recurrenceEnd) {
          return {
            status: 'series_ended' as SessionStatus,
            nextOccurrence: null,
            countdown: '',
          }
        }
      }

      // Find next occurrence that could still be live or upcoming
      const nextDates = rule.after(new Date(now.getTime() - durationMs), true)

      if (!nextDates) {
        return {
          status: 'series_ended' as SessionStatus,
          nextOccurrence: null,
          countdown: '',
        }
      }

      const nextStart = nextDates
      const nextEnd = new Date(nextStart.getTime() + durationMs)

      if (now < nextStart) {
        return {
          status: 'upcoming' as SessionStatus,
          nextOccurrence: nextStart,
          countdown: formatCountdown(nextStart, now),
        }
      } else if (now >= nextStart && now <= nextEnd) {
        return {
          status: 'live' as SessionStatus,
          nextOccurrence: nextStart,
          countdown: '',
        }
      } else {
        // Find the actual next future occurrence
        const futureDate = rule.after(now, false)
        if (futureDate) {
          return {
            status: 'upcoming' as SessionStatus,
            nextOccurrence: futureDate,
            countdown: formatCountdown(futureDate, now),
          }
        }
        return {
          status: 'series_ended' as SessionStatus,
          nextOccurrence: null,
          countdown: '',
        }
      }
    } catch {
      return { status: 'ended' as SessionStatus, nextOccurrence: null, countdown: '' }
    }
  }, [schedule])

  const statusConfig = {
    upcoming: {
      label: 'Upcoming',
      icon: Clock,
      badgeClass: 'bg-amber-100 text-amber-700',
    },
    live: {
      label: 'Live Now',
      icon: Radio,
      badgeClass: 'bg-red-100 text-red-600',
    },
    ended: {
      label: 'Ended',
      icon: CalendarCheck,
      badgeClass: 'bg-gray-100 text-gray-500',
    },
    series_ended: {
      label: 'Series Ended',
      icon: CalendarX,
      badgeClass: 'bg-gray-100 text-gray-500',
    },
  }

  const currentStatus = statusConfig[status]
  const StatusIcon = currentStatus.icon

  return (
    <div className="flex flex-col items-center justify-center py-12 px-6">
      {/* Provider badge */}
      <div
        className={`${getProviderColor(provider)} text-white text-xs font-semibold px-3 py-1 rounded-full mb-6`}
      >
        {getProviderLabel(provider)}
      </div>

      {/* Status badge */}
      <div
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium mb-4 ${currentStatus.badgeClass}`}
      >
        <StatusIcon className={`size-4 ${status === 'live' ? 'animate-pulse' : ''}`} />
        {currentStatus.label}
      </div>

      {/* Countdown / Next occurrence */}
      {status === 'upcoming' && nextOccurrence && (
        <div className="text-center mb-6">
          <p className="text-sm text-gray-500 mb-1">Next session</p>
          <p className="text-lg font-semibold text-gray-900">
            {nextOccurrence.toLocaleDateString(undefined, {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
          <p className="text-sm text-gray-600">
            {nextOccurrence.toLocaleTimeString(undefined, {
              hour: '2-digit',
              minute: '2-digit',
            })}
            {schedule?.timezone ? ` (${schedule.timezone})` : ''}
          </p>
          {countdown && (
            <p className="text-sm text-amber-600 font-medium mt-2">{countdown}</p>
          )}
        </div>
      )}

      {status === 'live' && (
        <p className="text-sm text-gray-500 mb-6">The session is happening right now</p>
      )}

      {(status === 'ended' || status === 'series_ended') && (
        <p className="text-sm text-gray-500 mb-6">This session has ended</p>
      )}

      {/* Join button */}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={`flex items-center gap-2 px-6 py-3 rounded-xl font-medium text-white transition-all duration-200 ${
          status === 'live'
            ? 'bg-red-500 hover:bg-red-600 shadow-lg shadow-red-200'
            : 'bg-gray-900 hover:bg-gray-800'
        }`}
      >
        {status === 'live' ? (
          <Video className="size-5" />
        ) : (
          <ExternalLink className="size-5" />
        )}
        {status === 'live' ? 'Join Now' : 'Open Meeting Link'}
      </a>

      {/* Recurrence info */}
      {schedule?.recurrence && (
        <p className="text-xs text-gray-400 mt-4">
          Recurring session
          {schedule.recurrence.end_date &&
            ` · Until ${new Date(schedule.recurrence.end_date).toLocaleDateString()}`}
        </p>
      )}
    </div>
  )
}

function formatCountdown(target: Date, now: Date): string {
  const diffMs = target.getTime() - now.getTime()
  if (diffMs <= 0) return ''

  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))

  if (days > 0) return `in ${days}d ${hours}h`
  if (hours > 0) return `in ${hours}h ${minutes}m`
  return `in ${minutes}m`
}

function toRRuleDateString(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

export default LiveSession
