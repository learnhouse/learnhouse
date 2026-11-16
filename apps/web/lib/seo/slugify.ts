/**
 * Human-readable URL slugs. Mirror of `apps/api/src/services/seo/slugify.py`
 * (the API is the source of truth; this one powers the live URL preview).
 * Both are tested against the same fixtures.
 */

export const SLUG_MAX_LENGTH = 80

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const UUID_LIKE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const RESERVED = new Set([
  'activity', 'activities', 'admin', 'api', 'create', 'dash', 'edit',
  'embed', 'end', 'feed', 'index', 'new', 'none', 'null', 'og',
  'preview', 'robots', 'settings', 'sitemap', 'undefined', 'updates',
])

const TABLE: Record<string, string> = {
  // Latin letters NFKD doesn't decompose
  ß: 'ss', æ: 'ae', ø: 'o', œ: 'oe', đ: 'd', ð: 'd', ł: 'l', þ: 'th', ı: 'i', ħ: 'h', ŋ: 'ng', ĸ: 'k', ſ: 's', ŧ: 't',
  // Cyrillic
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  є: 'ye', і: 'i', ї: 'yi', ґ: 'g', ў: 'u', ђ: 'dj', ј: 'j', љ: 'lj', њ: 'nj', ћ: 'c', џ: 'dz', ѓ: 'gj', ќ: 'kj', ѕ: 'dz',
  // Greek
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x',
  ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o',
  // Arabic, Persian
  'ا': 'a', 'أ': 'a', 'إ': 'i', 'آ': 'a', 'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'j', 'ح': 'h', 'خ': 'kh', 'د': 'd',
  'ذ': 'dh', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': 'a', 'غ': 'gh',
  'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h', 'و': 'w', 'ي': 'y', 'ى': 'a', 'ة': 'h',
  'ء': '', 'ئ': 'y', 'ؤ': 'w', 'پ': 'p', 'چ': 'ch', 'ژ': 'zh', 'گ': 'g', 'ک': 'k', 'ی': 'y',
  // Hebrew
  'א': 'a', 'ב': 'b', 'ג': 'g', 'ד': 'd', 'ה': 'h', 'ו': 'v', 'ז': 'z', 'ח': 'ch', 'ט': 't', 'י': 'y', 'כ': 'k',
  'ך': 'k', 'ל': 'l', 'מ': 'm', 'ם': 'm', 'נ': 'n', 'ן': 'n', 'ס': 's', 'ע': '', 'פ': 'p', 'ף': 'f', 'צ': 'ts',
  'ץ': 'ts', 'ק': 'k', 'ר': 'r', 'ש': 'sh', 'ת': 't',
}

const JOINERS = new Set(["'", '’', '‘', '`', '´'])
const COMBINING = /\p{M}/u

export function transliterate(text: string): string {
  let out = ''
  for (const char of text.toLowerCase()) {
    if (JOINERS.has(char)) continue
    const mapped = TABLE[char]
    if (mapped !== undefined) {
      out += mapped
      continue
    }
    for (const part of char.normalize('NFKD')) {
      const sub = TABLE[part]
      if (sub !== undefined) out += sub
      else if (part.charCodeAt(0) < 128) out += part.toLowerCase()
      else if (!COMBINING.test(part)) out += ' '
    }
  }
  return out
}

export function slugify(text: string | null | undefined, maxLength = SLUG_MAX_LENGTH): string {
  if (!text) return ''
  let slug = transliterate(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (slug.length > maxLength) {
    let cut = slug.slice(0, maxLength)
    if (cut.slice(Math.floor(maxLength / 2)).includes('-')) cut = cut.slice(0, cut.lastIndexOf('-'))
    slug = cut.replace(/^-+|-+$/g, '')
  }
  return slug
}

export type SlugError = 'empty' | 'too_long' | 'invalid_characters' | 'looks_like_id' | 'reserved'

export function slugError(slug: string): SlugError | null {
  if (!slug) return 'empty'
  if (slug.length > SLUG_MAX_LENGTH) return 'too_long'
  if (!SLUG_RE.test(slug)) return 'invalid_characters'
  if (UUID_LIKE_RE.test(slug)) return 'looks_like_id'
  if (RESERVED.has(slug)) return 'reserved'
  return null
}

/** Whether a public URL key is a uuid (as opposed to a slug). */
export function isUuidKey(key: string): boolean {
  return UUID_LIKE_RE.test(key.toLowerCase())
}
