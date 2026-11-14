/**
 * Pure helpers for the notification center: day grouping, the translated
 * headline, quick-action labels. No React, no i18n instance: callers pass
 * the lookups in, so tests/notifications-format.test.mjs can run them.
 */

export type FormatItem = {
  notification_uuid: string
  type: string
  title: string
  count: number
  created_at: string
  data?: Record<string, any> | null
  actor?: { name: string } | null
}

export type DayBucket = 'today' | 'yesterday' | 'week' | 'earlier'

const DAY = 24 * 60 * 60 * 1000

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Which day header a timestamp sits under, in the viewer's local time. */
export function dayBucket(iso: string, now: Date = new Date()): DayBucket {
  const t = new Date(iso).getTime()
  if (isNaN(t)) return 'earlier'
  const today = startOfDay(now)
  if (t >= today) return 'today'
  if (t >= today - DAY) return 'yesterday'
  if (t >= today - 6 * DAY) return 'week'
  return 'earlier'
}

/** Groups by day bucket, newest first (rows are sorted by time, so a bucket appears once). */
export function groupByDay<T extends { created_at: string }>(items: T[], now: Date = new Date()): { bucket: DayBucket; items: T[] }[] {
  const out: { bucket: DayBucket; items: T[] }[] = []
  const time = (i: T) => {
    const t = new Date(i.created_at).getTime()
    return isNaN(t) ? 0 : t
  }
  const sorted = [...items].sort((a, b) => time(b) - time(a))
  for (const item of sorted) {
    const bucket = dayBucket(item.created_at, now)
    const last = out[out.length - 1]
    if (last && last.bucket === bucket) last.items.push(item)
    else out.push({ bucket, items: [item] })
  }
  return out
}

/** The `{{name}}` placeholders in an i18next template. */
export function placeholders(template: string): string[] {
  const names = new Set<string>()
  for (const m of template.matchAll(/{{\s*([a-zA-Z0-9_]+)\s*(?:,[^}]*)?}}/g)) names.add(m[1])
  return [...names]
}

/** Variables for the headline: the row's params, plus the actor and count. */
export function headlineParams(item: FormatItem): Record<string, string | number> {
  const params: Record<string, string | number> = {}
  for (const [k, v] of Object.entries((item.data?.params as Record<string, unknown>) || {})) {
    if (typeof v === 'string' || typeof v === 'number') params[k] = v
  }
  // The real actor wins over the copy stored at write time (renames, and
  // never a name that does not match the avatar).
  if (item.actor?.name) params.actor = item.actor.name
  if (params.count === undefined) params.count = item.count || 1
  return params
}

/** Candidate template keys, most specific first (under `notifications.copy.`). */
export function headlineKeys(item: FormatItem): string[] {
  const keys: string[] = []
  const kind = item.data?.kind
  if (item.type === 'live_session' && typeof kind === 'string') keys.push(`live_session_${kind}`)
  if ((item.count || 1) > 1) keys.push(`${item.type}_many`)
  keys.push(item.type)
  return keys
}

/**
 * The translated headline, or the server's English title when there is no
 * template for this type or the row lacks one of the template's variables.
 *
 * `template(key)` returns the English source template (to check variables),
 * `translate(key, params)` the localized sentence.
 */
export function resolveHeadline(
  item: FormatItem,
  template: (_key: string) => string | undefined,
  translate: (_key: string, _params: Record<string, string | number>) => string
): string {
  const params = headlineParams(item)
  for (const key of headlineKeys(item)) {
    const src = template(`notifications.copy.${key}`)
    if (typeof src !== 'string' || !src) continue
    if (placeholders(src).some((p) => params[p] === undefined || params[p] === '')) return item.title
    const out = translate(`notifications.copy.${key}`, params)
    return out && !out.includes('{{') ? out : item.title
  }
  return item.title
}

/** Candidate body template keys, most specific first (under `notifications.body.`). */
export function bodyKeys(item: FormatItem): string[] {
  const keys: string[] = []
  const kind = item.data?.kind
  const params = (item.data?.params as Record<string, unknown>) || {}
  if (typeof kind === 'string') keys.push(`${item.type}_${kind}`)
  if (params.feedback) keys.push(`${item.type}_feedback`)
  if (typeof params.count === 'number' && params.count > 1) keys.push(`${item.type}_many`)
  keys.push(item.type)
  return keys
}

/**
 * The translated detail line from the row's params (grade, feedback excerpt,
 * due date and start time in the viewer's timezone…), or the server's body.
 * `formatDate` turns an ISO instant into local text.
 */
export function resolveBody(
  item: FormatItem & { body?: string },
  template: (_key: string) => string | undefined,
  translate: (_key: string, _params: Record<string, string | number>) => string,
  formatDate: (_iso: string) => string
): string {
  const params = headlineParams(item)
  for (const [k, v] of Object.entries(params)) {
    if (k.endsWith('_at') && typeof v === 'string') {
      const text = formatDate(v)
      if (text) params[k.slice(0, -3)] = text
    }
  }
  for (const key of bodyKeys(item)) {
    const src = template(`notifications.body.${key}`)
    if (typeof src !== 'string' || !src) continue
    if (placeholders(src).some((p) => params[p] === undefined || params[p] === '')) continue
    const out = translate(`notifications.body.${key}`, params)
    if (out && !out.includes('{{')) return out
  }
  return item.body || ''
}

/**
 * The row's time, consistent with its day group: "now", "14m", "2h" today;
 * the clock time yesterday; weekday + time this week; the date before.
 */
export function rowTime(iso: string, locale: string, now: Date = new Date()): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const bucket = dayBucket(iso, now)
  const time = () => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(d)
  if (bucket === 'today') {
    const mins = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 60000))
    if (mins < 1) return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(0, 'second')
    if (mins < 60) return new Intl.NumberFormat(locale, { style: 'unit', unit: 'minute', unitDisplay: 'narrow' }).format(mins)
    return new Intl.NumberFormat(locale, { style: 'unit', unit: 'hour', unitDisplay: 'narrow' }).format(Math.floor(mins / 60))
  }
  if (bucket === 'yesterday') return time()
  if (bucket === 'week') return `${new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(d)} ${time()}`
  return new Intl.DateTimeFormat(locale, d.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { dateStyle: 'medium' }).format(d)
}

/** "99+" style badge text. */
export function badgeText(count: number): string {
  return count > 99 ? '99+' : String(count)
}

/** Remove one row from a list and say whether it was unread (for optimistic counts). */
export function withoutItem<T extends { notification_uuid: string; read?: boolean }>(items: T[], uuid: string): { items: T[]; wasUnread: boolean } {
  const hit = items.find((i) => i.notification_uuid === uuid)
  return { items: items.filter((i) => i.notification_uuid !== uuid), wasUnread: !!hit && hit.read === false }
}

/** Put a new row at the top, replacing an older copy of the same collapsed group. */
export function prependItem<T extends { notification_uuid: string; data?: Record<string, any> | null; type: string }>(
  items: T[],
  item: T,
  sameGroup: (_a: T, _b: T) => boolean = () => false
): T[] {
  return [item, ...items.filter((i) => i.notification_uuid !== item.notification_uuid && !sameGroup(i, item))]
}
