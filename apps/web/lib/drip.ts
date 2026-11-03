/**
 * Drip content helpers shared by the schedule editor and the learner views.
 *
 * Mirrors the API's rules (apps/api/src/services/courses/drip.py): a chapter
 * opens right away, a number of days after the learner's schedule starts
 * (their enrollment, or the cohort start date), or at a fixed date. It can
 * also wait for the previous chapter or other chosen chapters to be
 * completed, and close again a number of days after it opens.
 */

export type DripAnchor = 'enrollment' | 'fixed_date'
export type DripReleaseMode = 'immediate' | 'delay' | 'date'
export type DripLockReason = 'schedule' | 'enrollment' | 'previous' | 'prerequisites' | 'closed'

export interface DripSettings {
  enabled: boolean
  anchor: DripAnchor
  start_date: string | null
  early_access_usergroups: string[]
  notify_email: boolean
}

export interface DripRule {
  mode: DripReleaseMode
  delay_days: number
  release_at: string | null
  require_previous: boolean
  require_chapters: string[]
  available_days: number | null
}

export const DEFAULT_DRIP_SETTINGS: DripSettings = {
  enabled: false,
  anchor: 'enrollment',
  start_date: null,
  early_access_usergroups: [],
  notify_email: false,
}

export const DEFAULT_DRIP_RULE: DripRule = {
  mode: 'immediate',
  delay_days: 0,
  release_at: null,
  require_previous: false,
  require_chapters: [],
  available_days: null,
}

export const MAX_DELAY_DAYS = 3650

const DAY_MS = 24 * 60 * 60 * 1000

export function normalizeRule(rule: Partial<DripRule> | null | undefined): DripRule {
  return { ...DEFAULT_DRIP_RULE, ...(rule || {}) }
}

/**
 * One chapter every `every` days (or weeks): the first chapter opens on day 0,
 * the next one `every` later, and so on. Keeps each chapter's
 * "require previous" choice.
 */
export function everyInterval(
  rules: DripRule[],
  every: number,
  unit: 'days' | 'weeks'
): DripRule[] {
  const step = Math.max(1, Math.floor(every)) * (unit === 'weeks' ? 7 : 1)
  return rules.map((rule, index) => ({
    ...rule,
    mode: index === 0 ? 'immediate' : 'delay',
    delay_days: Math.min(index * step, MAX_DELAY_DAYS),
    release_at: null,
  }))
}

/**
 * When a chapter opens for a learner whose schedule started at `anchor`
 * (null when it depends on something other than time, e.g. a learner who
 * has not enrolled yet).
 */
export function releaseDate(rule: DripRule, anchor: Date | null): Date | null {
  if (rule.mode === 'date') return rule.release_at ? new Date(rule.release_at) : null
  if (!anchor) return null
  const days = rule.mode === 'delay' ? rule.delay_days : 0
  return new Date(anchor.getTime() + days * DAY_MS)
}

/** Whole days and remaining hours until `target`, never negative. */
export function timeUntil(target: Date, now: Date = new Date()): { days: number; hours: number } {
  const ms = Math.max(0, target.getTime() - now.getTime())
  const days = Math.floor(ms / DAY_MS)
  const hours = Math.floor((ms - days * DAY_MS) / (60 * 60 * 1000))
  return { days, hours }
}

/** `<input type="datetime-local">` value for an ISO date, in local time. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** ISO date (UTC) from a `datetime-local` value read as local time. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export type DayState = 'open' | 'upcoming' | 'closed' | 'dated'

/**
 * What a learner sees on day `day` of their schedule (day 0 = enrollment),
 * assuming they keep up with the lessons. Chapters on a fixed date can't be
 * placed on a learner's day line, so they come back as 'dated'.
 */
export function stateOnDay(rule: DripRule, day: number): DayState {
  if (rule.mode === 'date') return 'dated'
  const opens = rule.mode === 'delay' ? rule.delay_days : 0
  if (day < opens) return 'upcoming'
  if (rule.available_days && day >= opens + rule.available_days) return 'closed'
  return 'open'
}

/** Last day worth previewing: the latest opening or closing, plus a week. */
export function previewHorizon(rules: DripRule[]): number {
  const ends = rules.map((r) => {
    const opens = r.mode === 'delay' ? r.delay_days : 0
    return opens + (r.available_days ?? 0)
  })
  return Math.min(MAX_DELAY_DAYS, Math.max(14, ...ends) + 7)
}

export interface CalendarEvent {
  uid: string
  title: string
  start: Date
  url?: string
}

function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function icsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1')
}

/** An .ics calendar with one 30-minute event per upcoming chapter release. */
export function buildIcs(calendarName: string, events: CalendarEvent[], now: Date = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LearnHouse//Drip content//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${icsText(calendarName)}`,
  ]
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}@learnhouse`,
      `DTSTAMP:${icsDate(now)}`,
      `DTSTART:${icsDate(e.start)}`,
      `DTEND:${icsDate(new Date(e.start.getTime() + 30 * 60 * 1000))}`,
      `SUMMARY:${icsText(e.title)}`,
      ...(e.url ? [`URL:${e.url}`] : []),
      'END:VEVENT'
    )
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}
