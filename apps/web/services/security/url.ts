// Shared URL guards for user- or server-supplied values that flow into
// href/src attributes or navigation sinks (window.location / window.open).
//
const SAFE_ABSOLUTE = /^https?:$/i
const RELATIVE_BASE = 'https://relative.invalid/'
// Browsers normalize backslashes and remove tabs/newlines when parsing URLs.
// Reject them before a relative-path fast path can mistake an external URL
// (such as /\\example.org) for an internal destination.
function cleanUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null
  for (const character of url) {
    const code = character.charCodeAt(0)
    if (code <= 0x1f || code === 0x7f || character === '\\') return null
  }
  const value = url.trim()
  return value && !value.startsWith('//') ? value : null
}

/** A root-relative application path; empty paths are useful for URL builders. */
export function safeInternalPath(path: string | null | undefined, fallback = '/'): string {
  if (path === '') return ''
  const value = cleanUrl(path)
  if (!value || !value.startsWith('/')) return fallback
  try {
    return new URL(value, RELATIVE_BASE).origin === new URL(RELATIVE_BASE).origin
      ? value
      : fallback
  } catch {
    return fallback
  }
}

/**
 * Sanitize a value used in an href/src. Returns a safe string:
 * - relative paths (`/x`, `x`, `#x`, `?x`) pass through (but not protocol-relative `//`),
 * - `http:`, `https:` and `mailto:` absolute URLs pass through,
 * - anything else (javascript:, data:, vbscript:, …) collapses to `'#'`.
 */
export function safeHref(url: string | null | undefined): string {
  const t = cleanUrl(url)
  if (!t) return '#'
  try {
    const parsed = new URL(t, RELATIVE_BASE)
    if (parsed.username || parsed.password) return '#'
    if (SAFE_ABSOLUTE.test(parsed.protocol) || parsed.protocol === 'mailto:') return t
  } catch {
    return '#'
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
  const t = cleanUrl(url)
  if (!t) return null
  try {
    const parsed = new URL(t)
    return SAFE_ABSOLUTE.test(parsed.protocol) && !parsed.username && !parsed.password ? t : null
  } catch {
    return null
  }
}

/** Image sources also permit local blob URLs and base64 raster previews. */
export function safeImageSrc(url: string | null | undefined): string | undefined {
  const value = cleanUrl(url)
  if (!value) return undefined
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,[a-z0-9+/]+=*$/i.test(value)) {
    return value
  }
  try {
    const parsed = new URL(value, RELATIVE_BASE)
    if (parsed.protocol === 'blob:') return value
    if (SAFE_ABSOLUTE.test(parsed.protocol) && !parsed.username && !parsed.password) return value
  } catch {
    return undefined
  }
  return undefined
}
