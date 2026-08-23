/*
 Normalize a pasted H5P embed URL.

 We never host H5P ourselves (see the comment on the blockH5P extension), so
 whatever the author pastes has to be turned into something an <iframe> can
 load as-is. Hosts hand out a few different shapes: a content page URL, a
 ready-made embed URL, or a whole <iframe> snippet.

 There is deliberately NO host allowlist — self-hosted H5P (Drupal, Moodle,
 WordPress) is the common case and an allowlist would break every one of them.
 The only hard rule is the scheme: http/https, so `javascript:`, `data:` and
 `file:` can never reach the iframe src.

 Pure functions, no React — unit tested in apps/web/tests/h5p-url.test.mjs.
*/

export type H5PUrlErrorReason =
  | 'empty'
  | 'unparseable'
  | 'unsupported_protocol'

export type H5PUrlResult =
  | { ok: true; url: string }
  | { ok: false; reason: H5PUrlErrorReason }

const IFRAME_SRC_QUOTED = /<iframe[^>]*\ssrc\s*=\s*("([^"]*)"|'([^']*)')/i
const IFRAME_SRC_BARE = /<iframe[^>]*\ssrc\s*=\s*([^\s>]+)/i

/** Minimal HTML entity decode — embed snippets ship `&amp;` inside the src. */
function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
}

/**
 * Pull the src out of a full `<iframe …>` snippet. Returns null when the input
 * is not an iframe snippet, so callers can treat it as a plain URL.
 */
export function extractIframeSrc(input: string): string | null {
  if (!input || !/<iframe/i.test(input)) return null
  const quoted = input.match(IFRAME_SRC_QUOTED)
  if (quoted) {
    const value = quoted[2] !== undefined ? quoted[2] : quoted[3]
    return value ? decodeEntities(value.trim()) : null
  }
  const bare = input.match(IFRAME_SRC_BARE)
  if (bare && bare[1]) return decodeEntities(bare[1].trim())
  return null
}

/** True when the URL already points at an H5P embed endpoint. */
function looksLikeEmbedUrl(url: URL): boolean {
  const path = url.pathname.replace(/\/+$/, '').toLowerCase()
  if (path.endsWith('/embed') || path.includes('/embed/')) return true
  if (path.endsWith('/embed.php')) return true
  // WordPress plugin: /wp-admin/admin-ajax.php?action=h5p_embed&id=1
  if ((url.searchParams.get('action') || '').toLowerCase() === 'h5p_embed') return true
  // Generic ?embed=1 / ?embed=true style used by several self-hosted setups
  if (url.searchParams.has('embed')) return true
  return false
}

/** `https://x.h5p.com/content/<id>` → its `/embed` form. */
function toH5PComEmbed(url: URL): URL {
  const host = url.hostname.toLowerCase()
  if (host !== 'h5p.com' && !host.endsWith('.h5p.com')) return url
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length === 2 && segments[0].toLowerCase() === 'content') {
    const next = new URL(url.toString())
    next.pathname = `/content/${segments[1]}/embed`
    return next
  }
  return url
}

/**
 * Turn author input into an iframe-ready H5P embed URL.
 *
 * Accepts a content page URL, an embed URL, a schemeless URL, or a pasted
 * `<iframe>` snippet. Returns a discriminated result instead of throwing so
 * the UI can show the reason.
 */
export function normalizeH5PUrl(input: string): H5PUrlResult {
  if (typeof input !== 'string') return { ok: false, reason: 'empty' }

  const trimmed = input.trim()
  if (!trimmed) return { ok: false, reason: 'empty' }

  let candidate = extractIframeSrc(trimmed) ?? trimmed
  candidate = candidate.trim()
  if (!candidate) return { ok: false, reason: 'unparseable' }

  // A URL never contains raw whitespace; this catches pasted prose early.
  if (/\s/.test(candidate)) return { ok: false, reason: 'unparseable' }

  const hasScheme =
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate) || candidate.startsWith('//')
  if (candidate.startsWith('//')) {
    candidate = `https:${candidate}`
  } else if (!hasScheme) {
    candidate = `https://${candidate}`
  }

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return { ok: false, reason: 'unparseable' }
  }

  // The whole point of this module: nothing but http(s) reaches the iframe.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'unsupported_protocol' }
  }
  if (!parsed.hostname) return { ok: false, reason: 'unparseable' }

  // A bare word ("hello") parses fine once we prefix https://, which would
  // leave the author staring at a dead frame. Require a dotted host unless
  // they typed a scheme themselves — intranet hosts like
  // `http://h5p-server/h5p/embed/1` stay valid that way.
  const isDotted = parsed.hostname.includes('.')
  const isLocal = parsed.hostname === 'localhost' || parsed.hostname.startsWith('[')
  if (!hasScheme && !isDotted && !isLocal) {
    return { ok: false, reason: 'unparseable' }
  }

  if (looksLikeEmbedUrl(parsed)) {
    return { ok: true, url: parsed.toString() }
  }

  return { ok: true, url: toH5PComEmbed(parsed).toString() }
}
