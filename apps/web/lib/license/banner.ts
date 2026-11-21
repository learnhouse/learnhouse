// What the dashboard license banner says, as pure functions over the
// /instance/license status (contract section 3). The component only maps the
// result onto the design system; tests/license-lock.test.mjs covers this.

export type LicenseBannerTone = 'neutral' | 'warning' | 'critical'

export interface LicenseBannerNotice {
  code?: string
  severity?: string
  message?: string
  ends_at?: number | null
}

export interface LicenseBannerStatus {
  mode?: string
  status?: string
  reason?: string
  grace_ends_at?: number | null
  notices?: LicenseBannerNotice[]
}

export interface LicenseBannerItem {
  /** Stable per notice, so a dismissal survives a refetch. */
  id: string
  kind: 'notice' | 'grace' | 'inactive'
  tone: LicenseBannerTone
  /** Only informational notices can be hidden (for the browser session). */
  dismissible: boolean
  code?: string
  message?: string
  /** Epoch seconds. */
  endsAt?: number | null
  reason?: string
}

const TONE_BY_SEVERITY: Record<string, LicenseBannerTone> = {
  info: 'neutral',
  warning: 'warning',
  critical: 'critical',
}

const TONE_ORDER: Record<LicenseBannerTone, number> = { critical: 0, warning: 1, neutral: 2 }

/** Notice codes the banner words itself (anything else shows the server's message). */
export const KNOWN_NOTICE_CODES = ['poc_ends', 'license_expires', 'payment_overdue', 'seat_limit_exceeded', 'org_limit_exceeded'] as const

/** Heartbeat reasons with a friendly phrase under `license.reason.*`. */
export const KNOWN_REASONS = [
  'expired',
  'payment_overdue',
  'revoked',
  'unknown_key',
  'org_inactive',
  'key_not_issued',
  'suspended',
  'not_yet_valid',
  'activation_limit',
  'seat_limit_exceeded',
  'grace_expired',
] as const

/**
 * The bars to show, most severe first. Empty unless this is an EE instance
 * and the caller got the full status (admins): the reduced answer other users
 * get has no `notices`.
 */
export function licenseBannerItems(lic: LicenseBannerStatus | null | undefined): LicenseBannerItem[] {
  if (!lic || lic.mode !== 'ee' || !Array.isArray(lic.notices)) return []
  const items: LicenseBannerItem[] = []

  if (lic.status === 'grace') {
    items.push({ id: 'status:grace', kind: 'grace', tone: 'warning', dismissible: false, endsAt: lic.grace_ends_at ?? null })
  }
  if (lic.status === 'inactive' && lic.reason && lic.reason !== 'no_key') {
    items.push({ id: `status:inactive:${lic.reason}`, kind: 'inactive', tone: 'critical', dismissible: false, reason: lic.reason })
  }

  for (const n of lic.notices) {
    if (!n || typeof n !== 'object') continue
    const code = typeof n.code === 'string' ? n.code : ''
    const message = typeof n.message === 'string' ? n.message : ''
    if (!code && !message) continue
    // The grace bar above already says this; EE also lists it as a local notice.
    if (lic.status === 'grace' && /grace|offline/.test(code)) continue
    const tone = TONE_BY_SEVERITY[n.severity ?? ''] ?? 'neutral'
    const endsAt = typeof n.ends_at === 'number' ? n.ends_at : null
    items.push({
      id: `notice:${code || message}:${endsAt ?? ''}`,
      kind: 'notice',
      tone,
      dismissible: tone === 'neutral',
      code: code || undefined,
      message: message || undefined,
      endsAt,
    })
  }

  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => TONE_ORDER[a.item.tone] - TONE_ORDER[b.item.tone] || a.i - b.i)
    .map(({ item }) => item)
}

/** "in 5 days", "tomorrow", "in 3 hours": localised by Intl. */
export function relativeWhen(endsAt: number, locale: string, now: number = Date.now()): string {
  const diffMs = endsAt * 1000 - now
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const hours = diffMs / 3_600_000
  if (Math.abs(hours) < 24) return rtf.format(Math.round(hours), 'hour')
  return rtf.format(Math.round(hours / 24), 'day')
}

/** "Dec 3" (with the year when it isn't this year). */
export function shortDate(endsAt: number, locale: string, now: number = Date.now(), withTime = false): string {
  const date = new Date(endsAt * 1000)
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', calendar: 'gregory' }
  if (date.getFullYear() !== new Date(now).getFullYear()) options.year = 'numeric'
  if (withTime) {
    options.hour = 'numeric'
    options.minute = '2-digit'
  }
  return new Intl.DateTimeFormat(locale, options).format(date)
}

/** The `license.reason.*` key for a status reason ("grace_expired:…" keeps its prefix). */
export function reasonKey(reason: string | undefined): string {
  const base = (reason || '').split(':')[0]
  return (KNOWN_REASONS as readonly string[]).includes(base) ? `license.reason.${base}` : 'license.reason.unknown'
}

type Translate = (_key: string, _options?: Record<string, unknown>) => string

/** The sentence a bar shows. `t` is i18next's; `locale` an Intl locale tag. */
export function licenseBannerText(item: LicenseBannerItem, t: Translate, locale: string, now: number = Date.now()): string {
  const endsAt = item.endsAt ?? null
  if (item.kind === 'grace') {
    return endsAt
      ? t('license.banner.grace', { date: shortDate(endsAt, locale, now, true) })
      : t('license.banner.grace_nodate')
  }
  if (item.kind === 'inactive') {
    return t('license.banner.inactive', { reason: t(reasonKey(item.reason)) })
  }
  switch (item.code) {
    case 'poc_ends':
      return endsAt ? t('license.banner.poc_ends', { when: relativeWhen(endsAt, locale, now) }) : t('license.banner.poc_ends_soon')
    case 'license_expires':
      return endsAt
        ? t('license.banner.license_expires', { when: relativeWhen(endsAt, locale, now) })
        : t('license.banner.license_expires_soon')
    case 'payment_overdue':
      return endsAt
        ? t('license.banner.payment_overdue', { date: shortDate(endsAt, locale, now) })
        : t('license.banner.payment_overdue_nodate')
    case 'seat_limit_exceeded':
      return t('license.banner.seat_limit_exceeded')
    case 'org_limit_exceeded':
      return t('license.banner.org_limit_exceeded')
  }
  // A code this build doesn't know yet (or an EE-local notice): the server's
  // own sentence, with the date when there is one.
  const message = item.message || t('license.banner.generic')
  return endsAt ? t('license.banner.with_when', { message, when: relativeWhen(endsAt, locale, now) }) : message
}
