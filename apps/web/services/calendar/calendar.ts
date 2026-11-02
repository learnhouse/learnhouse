import { getAPIUrl } from '@services/config/config'
import { RequestBodyWithAuthHeader, errorHandling } from '@services/utils/ts/requests'

export type CalendarEventType =
  | 'assignment'
  | 'live_session'
  | 'chapter_release'
  | 'chapter_close'
  | 'course_start'
  | 'course_update'
  | 'certificate'
  | 'podcast_episode'
  | (string & {})

export interface CalendarEvent {
  id: string
  type: CalendarEventType
  title: string
  /** ISO 8601 UTC instant, or a bare `YYYY-MM-DD` when `all_day` is set. */
  starts_at: string
  ends_at: string | null
  all_day: boolean
  /** Org-relative frontend path. */
  url: string | null
  course: { course_uuid: string; name: string } | null
  status: string | null
  meta: Record<string, any>
}

/** Events the signed-in user can act on between `start` and `end` (exclusive). */
export async function getCalendarEvents(
  orgId: number,
  start: Date,
  end: Date,
  token?: string
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() })
  const res = await fetch(
    `${getAPIUrl()}calendar/org/${orgId}/events?${params}`,
    RequestBodyWithAuthHeader('GET', null, null, token)
  )
  return errorHandling(res)
}
