// Course (and podcast) tags are stored as one string. The dashboard, the AI
// course planner and Atlas have always written "a|b|c", while demo bundles,
// LMS imports and older data hold "a,b,c". Reading only one of the two showed
// a comma list as a single tag.
//
// Rule: a value that contains "|" is pipe-separated (so a tag may contain a
// comma); otherwise it is comma-separated. We always write "|". The tag input
// already uses the comma as its "add tag" key, so no tag typed in the UI can
// contain one.
export const TAG_SEPARATOR = '|'

export function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim()).filter(Boolean)
  if (typeof raw !== 'string' || !raw.trim()) return []
  const separator = raw.includes('|') ? '|' : ','
  const seen = new Set<string>()
  const tags: string[] = []
  for (const part of raw.split(separator)) {
    const tag = part.trim()
    if (!tag || seen.has(tag.toLowerCase())) continue
    seen.add(tag.toLowerCase())
    tags.push(tag)
  }
  return tags
}

export function serializeTags(tags: string[]): string {
  const clean = tags.map((t) => t.replace(/\|/g, ' ').trim()).filter(Boolean)
  // A lone tag with a comma (possible via the API) would read back as a
  // comma list; a trailing "|" marks the value as pipe-separated.
  if (clean.length === 1 && clean[0].includes(',')) return `${clean[0]}${TAG_SEPARATOR}`
  return clean.join(TAG_SEPARATOR)
}

// Rewrites a stored value in the canonical form ("a,b" -> "a|b").
export function normalizeTags(raw: unknown): string {
  return serializeTags(parseTags(raw))
}
