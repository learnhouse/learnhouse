/**
 * Client-side keyword matching for the command palette's page entries.
 *
 * Kept free of React and path aliases so it can be unit-tested directly.
 * Every word of the query has to appear in the page's title, description or
 * keywords, in any order, the same rule the API applies to content.
 */

export interface PageSearchText {
  title: string
  description?: string
  keywords?: string
}

export function normalizeForMatch(value: string | null | undefined): string {
  if (!value) return ''
  return value.normalize('NFC').toLowerCase().trim()
}

export function queryTerms(query: string | null | undefined): string[] {
  return normalizeForMatch(query).split(/\s+/u).filter(Boolean)
}

/**
 * Score a page against the query. 0 means no match. Higher means a better
 * match: a title hit outranks a description hit, which outranks a keyword
 * hit, so "courses" lists the Courses page before pages that merely mention
 * courses in their keywords.
 */
export function scorePage(page: PageSearchText, query: string): number {
  const terms = queryTerms(query)
  if (terms.length === 0) return 1

  const title = normalizeForMatch(page.title)
  const description = normalizeForMatch(page.description)
  const keywords = normalizeForMatch(page.keywords)
  const haystack = `${title} ${description} ${keywords}`

  if (!terms.every((term) => haystack.includes(term))) return 0

  let score = 1
  if (terms.every((term) => title.includes(term))) score += 3
  if (title.startsWith(terms[0])) score += 2
  if (terms.every((term) => description.includes(term))) score += 1
  return score
}

/**
 * Pages that match `query`, best first. With an empty query every page is
 * returned in its registry order, which is the "jump somewhere" list shown
 * before the user types.
 */
export function rankPages<T extends PageSearchText>(pages: T[], query: string): T[] {
  if (queryTerms(query).length === 0) return pages
  return pages
    .map((page, index) => ({ page, index, score: scorePage(page, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.page)
}

export interface HighlightPart {
  text: string
  match: boolean
}

/**
 * Split `text` into plain and matched runs for every query term, so a result
 * can show why it matched. Overlapping hits merge into one run. Matching is
 * case-insensitive; when lowercasing changes the string's length (a few
 * scripts do) offsets would drift, so the text comes back unmarked instead.
 */
export function highlightParts(text: string | null | undefined, query: string | null | undefined): HighlightPart[] {
  const source = text ?? ''
  const terms = queryTerms(query)
  if (!source || terms.length === 0) return source ? [{ text: source, match: false }] : []
  const haystack = source.normalize('NFC').toLowerCase()
  if (haystack.length !== source.length) return [{ text: source, match: false }]

  const ranges: Array<[number, number]> = []
  for (const term of terms) {
    let from = 0
    while (from <= haystack.length - term.length) {
      const at = haystack.indexOf(term, from)
      if (at === -1) break
      ranges.push([at, at + term.length])
      from = at + term.length
    }
  }
  if (ranges.length === 0) return [{ text: source, match: false }]

  ranges.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1]
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }

  const parts: HighlightPart[] = []
  let cursor = 0
  for (const [start, end] of merged) {
    if (start > cursor) parts.push({ text: source.slice(cursor, start), match: false })
    parts.push({ text: source.slice(start, end), match: true })
    cursor = end
  }
  if (cursor < source.length) parts.push({ text: source.slice(cursor), match: false })
  return parts
}
