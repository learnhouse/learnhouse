export function extractHtmlDocument(raw: string | null | undefined): string {
  if (!raw) return ''

  let text = raw

  const fenceMatch = text.match(/```(?:html)?\s*\n?/i)
  if (fenceMatch && fenceMatch.index !== undefined) {
    const start = fenceMatch.index + fenceMatch[0].length
    const end = text.indexOf('```', start)
    text = end !== -1 ? text.slice(start, end) : text.slice(start)
  }

  const docStart = text.match(/<!doctype\s+html[^>]*>|<html[\s>]/i)
  if (docStart && docStart.index !== undefined && docStart.index > 0) {
    text = text.slice(docStart.index)
  }

  const docEnd = text.match(/<\/html\s*>/i)
  if (docEnd && docEnd.index !== undefined) {
    text = text.slice(0, docEnd.index + docEnd[0].length)
  }

  return text.trim()
}
