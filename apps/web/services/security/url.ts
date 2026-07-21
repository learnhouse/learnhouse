// Shared URL guards for user- or server-supplied values that flow into
// href/src attributes or navigation sinks (window.location / window.open).
//
// The goal is to block dangerous schemes — `javascript:`, `data:`, `vbscript:`,
// `blob:` — that turn a link/redirect into script execution or an open-redirect,
// while leaving legitimate links working. Two helpers, by sink type:
//   - safeHref:        for href/src on internal + external links (allows
//                      relative paths, http(s) and mailto).
//   - safeExternalUrl: for absolute URLs handed to window.location / window.open
//                      (http(s) only; returns null when unsafe so the caller can
//                      skip the navigation).

const SAFE_ABSOLUTE = /^https?:$/i

/**
 * Sanitize a value used in an href/src. Returns a safe string:
 * - relative paths (`/x`, `x`, `#x`, `?x`) pass through (but not protocol-relative `//`),
 * - `http:`, `https:` and `mailto:` absolute URLs pass through,
 * - anything else (javascript:, data:, vbscript:, …) collapses to `'#'`.
 */
export function safeHref(url: string | null | undefined): string {
  if (!url || typeof url !== 'string') return '#'
  const t = url.trim()
  if (!t) return '#'
  // Relative / same-document references — safe, and not absolute URLs.
  if (/^[/?#]/.test(t) && !t.startsWith('//')) return t
  try {
    const { protocol } = new URL(t)
    if (SAFE_ABSOLUTE.test(protocol) || protocol === 'mailto:') return t
  } catch {
    // Not parseable as absolute; treat a bare relative token (no scheme) as safe.
    if (!/^[a-z][a-z0-9+.-]*:/i.test(t) && !t.startsWith('//')) return t
  }
  return '#'
}

/**
 * Validate an absolute URL destined for a navigation sink (window.location.href
 * / window.open). Returns the URL only when it is an http(s) URL, else `null`,
 * so callers can guard the navigation. Server-provided OAuth/portal URLs are
 * legitimately cross-origin, so this checks the scheme rather than the origin.
 */
export function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null
  const t = url.trim()
  try {
    const { protocol } = new URL(t)
    return SAFE_ABSOLUTE.test(protocol) ? t : null
  } catch {
    return null
  }
}
