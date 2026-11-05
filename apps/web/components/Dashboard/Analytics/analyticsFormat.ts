// Small display helpers shared by the analytics widgets.

/** Regional-indicator flag for an ISO 3166-1 alpha-2 code ("FR" -> 🇫🇷). */
export function countryFlag(code?: string | null): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return '🌐'
  return String.fromCodePoint(...code.toUpperCase().split('').map((c) => 0x1f1a5 + c.charCodeAt(0)))
}

const regionNames = new Map<string, Intl.DisplayNames | null>()

/** Country name in the interface language, falling back to the code. */
export function countryName(code: string | null | undefined, locale: string): string {
  if (!code) return ''
  if (!regionNames.has(locale)) {
    try {
      regionNames.set(locale, new Intl.DisplayNames([locale, 'en'], { type: 'region' }))
    } catch {
      regionNames.set(locale, null)
    }
  }
  try {
    return regionNames.get(locale)?.of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}

const ACTIVITY_TYPE_KEYS: Record<string, string> = {
  video: 'analytics.course_analytics.type_labels.video',
  document: 'analytics.course_analytics.type_labels.document',
  quiz: 'analytics.course_analytics.type_labels.quiz',
  assignment: 'analytics.course_analytics.type_labels.assignment',
  dynamic: 'analytics.course_analytics.type_labels.dynamic',
  custom: 'analytics.course_analytics.type_labels.custom',
}

/** "TYPE_VIDEO" -> "Video" (translated). Unknown types are prettified. */
export function activityTypeLabel(type: string | null | undefined, t: (_key: string) => string): string {
  if (!type) return ''
  const key = type.replace(/^TYPE_/, '').toLowerCase()
  if (key === 'scorm') return 'SCORM'
  if (ACTIVITY_TYPE_KEYS[key]) return t(ACTIVITY_TYPE_KEYS[key])
  const words = key.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * One row per day for the last `days` days (oldest first), merging the given
 * series by `date`. Days with no row get 0, so charts don't draw a straight
 * line across a gap as if traffic had been steady.
 */
export function fillDays(
  days: number,
  series: Record<string, { rows: any[]; key: string }>,
): Array<Record<string, any>> {
  const byDate: Record<string, Record<string, any>> = {}
  const today = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i))
    const date = isoDay(d)
    byDate[date] = { date, ...Object.fromEntries(Object.keys(series).map((name) => [name, 0])) }
  }
  for (const [name, { rows, key }] of Object.entries(series)) {
    for (const row of rows ?? []) {
      const date = String(row.date ?? '').slice(0, 10)
      if (byDate[date]) byDate[date][name] = Number(row[key] ?? 0)
    }
  }
  return Object.values(byDate)
}

/** Percent change from `previous` to `current`, or null when there's nothing to compare. */
export function percentChange(current: number, previous: number): number | null {
  if (!previous) return null
  return Math.round(((current - previous) / previous) * 100)
}
