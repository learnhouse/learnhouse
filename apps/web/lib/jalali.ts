/**
 * Jalali (Hijri Shamsi / Persian / Solar) <-> Gregorian date conversion.
 *
 * Dependency-free on purpose. The project ships dayjs but no Jalali plugin, and
 * the product's date layer (lib/format.ts) is deliberately Gregorian + Latin
 * digits everywhere. The Persian calendar is a *display* concern for the date
 * picker only: the picker still stores and emits Gregorian ISO strings so it
 * stays a drop-in for every existing `<input type="date">` value.
 *
 * The math is a faithful transcription of the Borkowski algorithm as published
 * in jalaali-js (Behrang Noruzi Niya / Roozbeh Pournader / K.M. Borkowski),
 * exact for the Jalali year range -61..3177. Public-domain calendar math.
 */

/** A plain Jalali date. Months are 1-12, days are 1-31. */
export interface JalaliDate {
  jy: number
  jm: number
  jd: number
}

/** A plain Gregorian date. Months are 1-12, days are 1-31. */
export interface GregorianDate {
  gy: number
  gm: number
  gd: number
}

/** Integer division truncating toward zero (matches the reference). */
function div(a: number, b: number): number {
  return ~~(a / b)
}

/** Non-negative modulo for positive `b` (Python-style). */
function mod(a: number, b: number): number {
  return a - ~~(a / b) * b
}

const BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097,
  2192, 2262, 2324, 2394, 2456, 3178,
]
const MIN_JALALI_YEAR = BREAKS[0]
const MAX_JALALI_YEAR = BREAKS[BREAKS.length - 1] - 1

interface JalCalResult {
  leap: number
  gy: number
  march: number
}

/**
 * Leap-cycle state of a Jalali year plus the Gregorian March day on which
 * Farvardin 1 of that year falls.
 */
function jalCal(jy: number): JalCalResult {
  if (!Number.isFinite(jy) || jy < MIN_JALALI_YEAR || jy > MAX_JALALI_YEAR) {
    throw new RangeError(`Jalali year out of range: ${jy}`)
  }

  const gy = jy + 621
  let leapJ = -14
  let jp = BREAKS[0]
  let jm = 0
  let jump = 0

  for (let i = 1; i < BREAKS.length; i += 1) {
    jm = BREAKS[i]
    jump = jm - jp
    if (jy < jm) break
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4)
    jp = jm
  }

  let n = jy - jp
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4)
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1

  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150
  const march = 20 + leapJ - leapG

  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33
  let leap = mod(mod(n + 1, 33) - 1, 4)
  if (leap === -1) leap = 4

  return { leap, gy, march }
}

/** Julian Day number of a Jalali date. */
function j2d(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy)
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1
}

/** Julian Day number of a Gregorian date. */
function g2d(gy: number, gm: number, gd: number): number {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) +
    gd -
    34840408
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752
  return d
}

/** Jalali date from a Julian Day number. */
function d2j(jdn: number): JalaliDate {
  const gy = d2g(jdn).gy
  let jy = gy - 621
  const r = jalCal(jy)
  const jdn1f = g2d(r.gy, 3, r.march)
  let k = jdn - jdn1f

  if (k >= 0) {
    if (k <= 185) {
      return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 }
    }
    k -= 186
  } else {
    jy -= 1
    k += 179
    if (r.leap === 1) k += 1
  }

  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 }
}

/** Gregorian date from a Julian Day number. */
function d2g(jdn: number): GregorianDate {
  let j = 4 * jdn + 139361631
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908
  const i = div(mod(j, 1461), 4) * 5 + 308
  const gd = div(mod(i, 153), 5) + 1
  const gm = mod(div(i, 153), 12) + 1
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6)
  return { gy, gm, gd }
}

/** Convert a Jalali date to Gregorian. */
export function jalaliToGregorian(jy: number, jm: number, jd: number): GregorianDate {
  return d2g(j2d(jy, jm, jd))
}

/** Convert a Gregorian date to Jalali. */
export function gregorianToJalali(gy: number, gm: number, gd: number): JalaliDate {
  return d2j(g2d(gy, gm, gd))
}

/** Whether a Jalali year is a leap year (Esfand has 30 days). */
export function isJalaliLeapYear(jy: number): boolean {
  return jalCal(jy).leap === 0
}

/** Number of days in a given Jalali month. */
export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31
  if (jm <= 11) return 30
  return isJalaliLeapYear(jy) ? 30 : 29
}

/** Persian month names, index 0 = Farvardin. */
export const JALALI_MONTHS = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
] as const

/**
 * Persian weekday short labels, starting on Saturday (شنبه) which is the first
 * day of the week in the Iranian calendar.
 */
export const JALALI_WEEKDAYS_SHORT = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'] as const

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹']

/** Render a number (or numeric string) with Persian-Indic digits. */
export function toPersianDigits(value: number | string): string {
  return String(value).replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)])
}

/** Parse a string that may contain Persian-Indic digits back into ASCII. */
export function toLatinDigits(value: string): string {
  return value.replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
}

/**
 * Weekday column (0 = Saturday .. 6 = Friday) for the given Gregorian date,
 * matching the Saturday-first layout of JALALI_WEEKDAYS_SHORT.
 */
export function jalaliWeekColumn(gy: number, gm: number, gd: number): number {
  // JS getDay(): 0 = Sunday .. 6 = Saturday. Shift so Saturday -> 0.
  const jsDay = new Date(gy, gm - 1, gd).getDay()
  return (jsDay + 1) % 7
}

/** Build a "YYYY-MM-DD" Gregorian ISO date string (the picker's wire format). */
export function toGregorianISO(g: GregorianDate): string {
  const mm = String(g.gm).padStart(2, '0')
  const dd = String(g.gd).padStart(2, '0')
  return `${g.gy}-${mm}-${dd}`
}

/** Parse a "YYYY-MM-DD" (or longer ISO) string into a Gregorian date, or null. */
export function parseGregorianISO(value?: string | null): GregorianDate | null {
  if (!value) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!m) return null
  return { gy: Number(m[1]), gm: Number(m[2]), gd: Number(m[3]) }
}

/** Format a Gregorian ISO date as a readable Jalali label, e.g. "۱۲ مهر ۱۴۰۴". */
export function formatJalaliLabel(value?: string | null): string {
  const g = parseGregorianISO(value)
  if (!g) return ''
  const j = gregorianToJalali(g.gy, g.gm, g.gd)
  return `${toPersianDigits(j.jd)} ${JALALI_MONTHS[j.jm - 1]} ${toPersianDigits(j.jy)}`
}
