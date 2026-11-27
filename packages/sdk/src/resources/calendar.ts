import type { HttpCore } from '../core/http'
import type { BaseRequestOptions } from '../core/types'
import type { CalendarEvent } from '../models'

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value
}

/** The signed-in user's calendar: due dates, drip releases and other dated items. Sessions only. */
export function createCalendarResource(http: HttpCore) {
  return {
    /**
     * Events between `start` and `end` (Dates or ISO 8601 strings).
     * `GET /api/v1/calendar/org/{org_id}/events`
     */
    events(orgId: number, range: { start: Date | string; end: Date | string }, options?: BaseRequestOptions): Promise<CalendarEvent[]> {
      return http.GET('/api/v1/calendar/org/{org_id}/events', {
        ...options,
        params: { path: { org_id: orgId }, query: { start: iso(range.start), end: iso(range.end) } },
      })
    },
  }
}

export type CalendarResource = ReturnType<typeof createCalendarResource>
