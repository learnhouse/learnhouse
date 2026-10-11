// Where a copilot source points: the page to open and, for timed media and
// documents, the moment or page it came from.

export interface CopilotSource {
  source_type?: string
  course_uuid?: string
  course_name?: string
  chapter_name?: string
  activity_uuid?: string | null
  activity_name?: string
  block_uuid?: string | null
  locator?: { start?: number; page?: number } | null
  title?: string
  snippet?: string
  chunk_text?: string
  similarity?: number | null
}

export type SourceLocation = { kind: 'time'; seconds: number; label: string } | { kind: 'page'; page: number; label: string }

const stripPrefix = (value: string | null | undefined, prefix: string) =>
  (value || '').replace(new RegExp(`^${prefix}_`), '')

/** 192 -> "03:12", 3725 -> "1:02:05". */
export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** What to call a source: the activity, else the chapter or course it describes. */
export function sourceTitle(source: CopilotSource): string {
  return source.title || source.activity_name || source.chapter_name || source.course_name || ''
}

export function sourceLocation(source: CopilotSource): SourceLocation | null {
  const start = source.locator?.start
  if (typeof start === 'number' && Number.isFinite(start)) {
    return { kind: 'time', seconds: Math.floor(start), label: formatTimestamp(start) }
  }
  const page = source.locator?.page
  if (typeof page === 'number' && Number.isInteger(page) && page > 0) {
    return { kind: 'page', page, label: String(page) }
  }
  return null
}

/**
 * Org-relative path to open a source: the activity at the cited moment or
 * page, or the course page for course and chapter text. Null when the source
 * has no course to open.
 */
export function sourcePath(source: CopilotSource): string | null {
  const courseId = stripPrefix(source.course_uuid, 'course')
  if (!courseId) return null
  const activityId = stripPrefix(source.activity_uuid, 'activity')
  if (!activityId) return `/course/${courseId}`
  const location = sourceLocation(source)
  const query =
    location?.kind === 'time' ? `?t=${location.seconds}` : location?.kind === 'page' ? `?page=${location.page}` : ''
  return `/course/${courseId}/activity/${activityId}${query}`
}

/** A positive integer from a query parameter, or null. */
export function positiveIntParam(search: string, name: string): number | null {
  const raw = new URLSearchParams(search).get(name)
  if (!raw || !/^\d+$/.test(raw)) return null
  const value = Number(raw)
  return value > 0 ? value : null
}
