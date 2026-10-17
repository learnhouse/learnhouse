/**
 * Split free text into plain segments and the web links found inside it.
 *
 * Only http(s) URLs and `www.` hosts are recognised, so a mailto: or
 * javascript: string in user-provided text never becomes a clickable link.
 */
export type TextSegment =
  | { type: 'text'; value: string }
  | { type: 'link'; value: string; href: string }

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"'`]+/gi

// Punctuation that usually belongs to the sentence, not to the URL.
const TRAILING_PUNCTUATION = /[.,;:!?'")\]}]+$/

function trimTrailingPunctuation(raw: string): string {
  let url = raw.replace(TRAILING_PUNCTUATION, '')
  // Keep a closing bracket when the URL itself opened one, e.g. wiki links.
  while (raw.length > url.length && raw[url.length] === ')' && countChar(url, '(') > countChar(url, ')')) {
    url = raw.slice(0, url.length + 1)
  }
  return url
}

function countChar(value: string, char: string): number {
  let count = 0
  for (const c of value) if (c === char) count++
  return count
}

export function splitLinks(text: string | null | undefined): TextSegment[] {
  if (!text) return []
  const segments: TextSegment[] = []
  let cursor = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0
    const url = trimTrailingPunctuation(match[0])
    if (!url || url === 'www.') continue
    if (start > cursor) segments.push({ type: 'text', value: text.slice(cursor, start) })
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`
    segments.push({ type: 'link', value: url, href })
    cursor = start + url.length
  }
  if (cursor < text.length) segments.push({ type: 'text', value: text.slice(cursor) })
  return segments
}
