/**
 * Locale-aware date and number formatting — one place, so a locale change
 * reaches every date on screen.
 *
 * Before this existed, all 12 dayjs call sites extended `relativeTime` locally
 * and none imported a `dayjs/locale/*`, so "2 hours ago" rendered in English
 * in all 22 languages.
 */

import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { baseCode } from './direction'

dayjs.extend(relativeTime)

/** Mirrors LOCALE_LOADERS in lib/i18n.ts. English is dayjs's built-in default. */
const DAYJS_LOCALES: Record<string, () => Promise<unknown>> = {
  ar: () => import('dayjs/locale/ar'),
  bn: () => import('dayjs/locale/bn'),
  de: () => import('dayjs/locale/de'),
  es: () => import('dayjs/locale/es'),
  fa: () => import('dayjs/locale/fa'),
  fr: () => import('dayjs/locale/fr'),
  hi: () => import('dayjs/locale/hi'),
  id: () => import('dayjs/locale/id'),
  it: () => import('dayjs/locale/it'),
  ja: () => import('dayjs/locale/ja'),
  ko: () => import('dayjs/locale/ko'),
  nl: () => import('dayjs/locale/nl'),
  pl: () => import('dayjs/locale/pl'),
  pt: () => import('dayjs/locale/pt'),
  ru: () => import('dayjs/locale/ru'),
  sk: () => import('dayjs/locale/sk'),
  th: () => import('dayjs/locale/th'),
  tr: () => import('dayjs/locale/tr'),
  uk: () => import('dayjs/locale/uk'),
  vi: () => import('dayjs/locale/vi'),
  zh: () => import('dayjs/locale/zh'),
}

/**
 * Language tags reaching this app are NOT guaranteed to be BCP-47.
 *
 * `i18n.language` is whatever i18next's browser detector found, and every one of
 * its sources hands back an arbitrary string: `navigator.language` on
 * glibc/POSIX hosts reports forms like `en-US@posix`, the `?lng=` query param is
 * user-supplied, and the `i18next` cookie / `i18nextLng` localStorage entry
 * echo back whatever was detected earlier. Feed any of those to an Intl
 * constructor and it throws `RangeError: Invalid language tag`, which takes down
 * the whole render (it crashed the org landing page's thumbnail grid).
 *
 * So degrade instead of throwing: normalise the obvious POSIX/ISO-15897 spellings,
 * then fall back full tag -> base subtag -> 'en'.
 */
export function normalizeLanguageTag(lng?: string | null): string {
  // `en_US@posix` -> `en-US`. Underscores and an `@modifier` are the two forms
  // that reach us most and are both trivially recoverable.
  const raw = String(lng ?? '').trim().split('@')[0].replace(/_/g, '-')

  for (const candidate of [raw, baseCode(raw)]) {
    if (!candidate) continue
    try {
      // Exactly the validity check the Intl constructors run, without building
      // a formatter — so anything this accepts, they accept.
      Intl.getCanonicalLocales(candidate)
      return candidate
    } catch {
      /* not a valid BCP-47 tag — try the next fallback */
    }
  }

  return 'en'
}

/**
 * NUMERALS — a deliberate product decision, kept behind one function.
 *
 * `Intl.NumberFormat('ar')` resolves to Eastern Arabic-Indic digits (٠١٢٣٤) on
 * most ICU builds, and `ar-SA` additionally defaults to the Hijri calendar.
 * Neither is right here: prices, seat counts and analytics sit next to
 * Latin-digit data coming straight from the API, and mixed numeral systems on
 * one screen read as broken rather than localised. Arabic-speaking regions are
 * also split — ar-EG and ar-SA use Arabic-Indic, ar-MA and ar-TN use Western —
 * so a bare `ar` has no single correct answer.
 *
 * So: Latin digits and the Gregorian calendar, everywhere. Month names and
 * relative times still localise. Flip this one function if an org asks for
 * native numerals.
 *
 * This is also the single choke point every Intl constructor in this file goes
 * through, so normalizeLanguageTag() here is what keeps a malformed tag from
 * reaching formatDate/formatNumber/formatCurrency/formatPercent. Do not add a
 * `new Intl.*` anywhere that bypasses it.
 */
function intlLocale(lng?: string): string {
  const tag = normalizeLanguageTag(lng)
  const base = baseCode(tag)
  return base === 'ar' || base === 'fa' ? `${base}-u-nu-latn` : tag
}

/**
 * Load and activate the dayjs locale. Called from lib/i18n.ts on startup and on
 * every language change, so `dayjs.locale` is set before anything renders.
 */
export async function loadDateLocale(lng?: string): Promise<void> {
  const code = baseCode(lng)
  if (code === 'en') {
    dayjs.locale('en')
    return
  }
  const loader = DAYJS_LOCALES[code]
  if (!loader) return
  try {
    await loader()
    dayjs.locale(code)
  } catch (e) {
    console.warn(`Failed to load date locale: ${lng}`, e)
  }
}

/**
 * Absolute date. Goes through Intl rather than dayjs on purpose: dayjs's `ar`
 * locale emits Arabic-Indic digits in its date formats, which is exactly what
 * intlLocale() is there to avoid.
 */
export function formatDate(
  value: string | number | Date,
  lng?: string,
  options?: Intl.DateTimeFormatOptions
): string {
  return new Intl.DateTimeFormat(intlLocale(lng), {
    dateStyle: 'medium',
    calendar: 'gregory',
    ...options,
  }).format(new Date(value))
}

export function formatDateTime(
  value: string | number | Date,
  lng?: string,
  options?: Intl.DateTimeFormatOptions
): string {
  return formatDate(value, lng, { dateStyle: 'medium', timeStyle: 'short', ...options })
}

/** "2 hours ago". Words, not digits — which is why dayjs is fine here. */
export function formatRelative(value: string | number | Date, lng?: string): string {
  return dayjs(value).locale(baseCode(lng)).fromNow()
}

export function formatNumber(
  value: number,
  lng?: string,
  options?: Intl.NumberFormatOptions
): string {
  return new Intl.NumberFormat(intlLocale(lng), options).format(value)
}

export function formatCurrency(
  value: number,
  currency: string,
  lng?: string,
  options?: Intl.NumberFormatOptions
): string {
  return new Intl.NumberFormat(intlLocale(lng), {
    style: 'currency',
    currency,
    ...options,
  }).format(value)
}

export function formatPercent(
  value: number,
  lng?: string,
  options?: Intl.NumberFormatOptions
): string {
  return new Intl.NumberFormat(intlLocale(lng), {
    style: 'percent',
    maximumFractionDigits: 0,
    ...options,
  }).format(value)
}
