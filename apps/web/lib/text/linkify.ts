/**
 * Split free text into plain segments and the web links found inside it.
 *
 * Only http(s) URLs and `www.` hosts are recognised, so a mailto: or
 * javascript: string in user-provided text never becomes a clickable link.
 */
export type TextSegment =
  | { type: 'text'; value: string }
  | { type: 'link'; value: string; href: string }

// URL characters stop at whitespace, quotes, angle brackets and full-width
// CJK / Arabic punctuation, which never appears inside a real link.
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"'`\u060C\u061B\u061F\u3001\u3002\uFF01\uFF08\uFF09\uFF0C\uFF1A\uFF1B\uFF1F\u300C\u300D\u300E\u300F]+/gi

// Punctuation that usually belongs to the sentence, not to the URL.
const TRAILING_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?', "'", '"', ')', ']', '}'])

/**
 * Drop sentence punctuation from the end of a URL match, keeping a closing
 * bracket when the URL opened one (e.g. wiki links). Single pass, linear in
 * the match length: user text is unbounded, so no backtracking regexes here.
 */
function trimTrailingPunctuation(raw: string): string {
  let open = 0
  let close = 0
  for (const c of raw) {
    if (c === '(') open++
    else if (c === ')') close++
  }
  let end = raw.length
  while (end > 0 && TRAILING_PUNCTUATION.has(raw[end - 1])) {
    if (raw[end - 1] === ')' && close <= open) break
    if (raw[end - 1] === ')') close--
    end--
  }
  return raw.slice(0, end)
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
