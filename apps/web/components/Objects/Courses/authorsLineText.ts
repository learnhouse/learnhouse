/**
 * Pure text logic behind <CourseAuthorsLine>: which authors count, what each
 * is called, and how "By A, B and 3 others" is assembled in the viewer's
 * language. No React and no path aliases, so tests import it directly.
 */

export type AuthorRole = 'CREATOR' | 'MAINTAINER' | 'CONTRIBUTOR' | 'REPORTER'

export interface CourseAuthorUser {
  id?: number | string
  user_uuid: string
  first_name?: string | null
  last_name?: string | null
  username?: string | null
  avatar_image?: string | null
}

export interface CourseAuthorEntry {
  user?: CourseAuthorUser | null
  authorship?: AuthorRole | string | null
  authorship_status?: string | null
}

const ROLE_ORDER: Record<string, number> = { CREATOR: 0, MAINTAINER: 1, CONTRIBUTOR: 2, REPORTER: 3 }

/**
 * Active authors with a user, one entry per person, creators first. The sort
 * is stable, so authors of the same role keep the order the API gave.
 */
export function activeAuthors<T extends CourseAuthorEntry>(authors: readonly T[] | null | undefined): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const a of authors ?? []) {
    if (!a?.user?.user_uuid || a.authorship_status !== 'ACTIVE') continue
    if (seen.has(a.user.user_uuid)) continue
    seen.add(a.user.user_uuid)
    out.push(a)
  }
  const rank = (a: T) => ROLE_ORDER[String(a.authorship ?? '')] ?? 99
  return out
    .map((a, i) => ({ a, i }))
    .sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i)
    .map(({ a }) => a)
}

/** Full name, else whichever half is set, else @username. */
export function authorName(user: CourseAuthorUser | null | undefined): string {
  if (!user) return ''
  const full = [user.first_name, user.last_name]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(' ')
  if (full) return full
  return user.username ? `@${user.username}` : ''
}

/** One or two letters for the avatar fallback ("Victoria Adelmant" -> "VA"). */
export function authorInitials(user: CourseAuthorUser | null | undefined): string {
  const first = (user?.first_name ?? '').trim()
  const last = (user?.last_name ?? '').trim()
  let letters: string[]
  if (first || last) {
    const words = `${first} ${last}`.trim().split(/\s+/)
    letters = words.length > 1 ? [words[0], words[words.length - 1]] : [words[0]]
  } else {
    letters = [(user?.username ?? '').replace(/^@/, '')]
  }
  // Array.from keeps a non-BMP first character (emoji, some scripts) whole.
  const out = letters.map((w) => Array.from(w)[0] ?? '').join('')
  return out ? out.toLocaleUpperCase() : '?'
}

/**
 * Soft tints for initials avatars. Literal class strings so Tailwind keeps
 * them; dark mode remaps the 100 washes and 700 inks on its own. No violet:
 * that hue means AI.
 */
export const AVATAR_TINTS = [
  'bg-sky-100 text-sky-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-teal-100 text-teal-700',
  'bg-orange-100 text-orange-700',
  'bg-indigo-100 text-indigo-700',
  'bg-lime-100 text-lime-700',
] as const

/** The same person gets the same tint everywhere. */
export function avatarTint(seed: string | number | null | undefined): string {
  const s = String(seed ?? '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return AVATAR_TINTS[h % AVATAR_TINTS.length]
}

export type AuthorsLineSegment =
  | { type: 'text'; value: string }
  | { type: 'name'; value: string; index: number }
  | { type: 'others'; count: number }

export interface AuthorsLineOptions {
  /** The translated "By {{names}}" with {{names}} left as `slot`. */
  template: string
  /** The placeholder the caller interpolated into `template`. */
  slot: string
  /** Names spelled out before the rest collapse into "{n} others". */
  maxNamed?: number
  locale?: string
}

const OTHERS_SLOT = '\u0000others\u0000'

function listParts(items: string[], locale?: string): { type: 'element' | 'literal'; value: string }[] {
  try {
    const ListFormat = (Intl as any).ListFormat
    if (ListFormat) {
      return new ListFormat(locale || 'en', { style: 'long', type: 'conjunction' }).formatToParts(items)
    }
  } catch {
    // Unknown locale tag: fall through to the plain join.
  }
  const parts: { type: 'element' | 'literal'; value: string }[] = []
  items.forEach((v, i) => {
    if (i > 0) parts.push({ type: 'literal', value: i === items.length - 1 ? ' & ' : ', ' })
    parts.push({ type: 'element', value: v })
  })
  return parts
}

/**
 * The authors sentence as segments, so the UI can render "{n} others" as a
 * button. Three authors are all named (no "and 1 other"); from four, the first
 * `maxNamed` are named and the rest collapse. Conjunctions come from
 * Intl.ListFormat, so they follow the locale ("A, B y C", "A、B、C").
 */
export function authorsLineSegments(names: string[], opts: AuthorsLineOptions): AuthorsLineSegment[] {
  const clean = names.filter(Boolean)
  if (!clean.length) return []
  const maxNamed = Math.max(1, opts.maxNamed ?? 2)
  const collapse = clean.length > maxNamed + 1
  const named = collapse ? clean.slice(0, maxNamed) : clean
  const others = collapse ? clean.length - maxNamed : 0
  const items = others ? [...named, OTHERS_SLOT] : named

  const list: AuthorsLineSegment[] = []
  let nameIndex = 0
  for (const part of listParts(items, opts.locale)) {
    if (part.type === 'element' && part.value === OTHERS_SLOT) list.push({ type: 'others', count: others })
    else if (part.type === 'element') list.push({ type: 'name', value: part.value, index: nameIndex++ })
    else list.push({ type: 'text', value: part.value })
  }

  const at = opts.template.indexOf(opts.slot)
  const before = at >= 0 ? opts.template.slice(0, at) : ''
  const after = at >= 0 ? opts.template.slice(at + opts.slot.length) : ''
  return [
    ...(before ? [{ type: 'text' as const, value: before }] : []),
    ...list,
    ...(after ? [{ type: 'text' as const, value: after }] : []),
  ]
}
