// Pure helpers for the Magic block (unit-tested in tests/editor-blocks-flow.test.mjs).
import { extractHtmlDocument } from './extractHtml'

/** Credits one generation reserves (MagicBlock router: reserve_ai_credit(amount=3)). */
export const MAGIC_CREDIT_COST = 3

export type MagicErrorKind = 'credits' | 'rate' | 'disabled' | 'limit' | 'stopped' | 'other'

export interface MagicError {
  kind: MagicErrorKind
  message: string
}

/** Sort an API / stream error into something the block can explain. */
export function classifyMagicError(message: string): MagicError {
  const m = message.toLowerCase()
  if (/temporarily unavailable/.test(m)) return { kind: 'other', message }
  if (/credit/.test(m)) return { kind: 'credits', message }
  if (/rate limit|too many|429/.test(m)) return { kind: 'rate', message }
  if (/iteration|maximum/.test(m)) return { kind: 'limit', message }
  if (/disabled|not enabled|feature/.test(m)) return { kind: 'disabled', message }
  if (/^stopped/.test(m)) return { kind: 'stopped', message }
  return { kind: 'other', message }
}

const CSP =
  "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://d3js.org https://unpkg.com https://cdn.plot.ly https://cdn.babylonjs.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://fonts.googleapis.com https://unpkg.com; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net; connect-src 'self' https:; media-src 'self' https: data: blob:;"

/** The document handed to the iframe: full documents as-is, fragments wrapped (same as before the redesign). */
export function buildMagicDocument(raw: string | null | undefined): string | null {
  if (!raw) return null
  const html = extractHtmlDocument(raw) || raw
  if (html.trim().toLowerCase().startsWith('<!doctype')) return html
  return `<!DOCTYPE html>
<html style="height: 100%; width: 100%;">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${CSP}">
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  </style>
</head>
<body>
${html}
</body>
</html>`
}
