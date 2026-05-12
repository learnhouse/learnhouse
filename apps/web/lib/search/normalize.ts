/**
 * Shared client-side helpers for substring search/filter.
 *
 * Without NFC normalization, stored strings and the user's query can use
 * different unicode forms (NFC vs NFD), making emoji-with-modifiers (skin
 * tones, ZWJ family sequences) and accented characters silently fail to
 * match under `.toLowerCase().includes()`.
 */

export function normalizeForSearch(value: string | null | undefined): string {
  if (!value) return ''
  return value.normalize('NFC').toLowerCase().trim()
}

/**
 * Does `haystack` contain `needle`? Both sides are NFC-normalized and
 * lowercased so emoji and accented characters match consistently.
 */
export function searchMatches(
  haystack: string | null | undefined,
  needle: string | null | undefined,
): boolean {
  const n = normalizeForSearch(needle)
  if (!n) return true
  const h = normalizeForSearch(haystack)
  return h.includes(n)
}

/**
 * Convenience: true if any of the haystacks contains the needle.
 */
export function searchMatchesAny(
  haystacks: Array<string | null | undefined>,
  needle: string | null | undefined,
): boolean {
  const n = normalizeForSearch(needle)
  if (!n) return true
  return haystacks.some((h) => normalizeForSearch(h).includes(n))
}
