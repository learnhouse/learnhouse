/**
 * Centralized host/domain/port utility functions.
 * All functions strip ports internally before comparing.
 * IPv6 bracket-aware (e.g. [::1]:3000).
 * Zero dependencies — safe for Edge Runtime middleware.
 */

/**
 * Strip port from a host string.
 * "localhost:3000" -> "localhost"
 * "[::1]:3000" -> "::1"
 * "acme.io" -> "acme.io"
 * null/undefined -> ""
 */
export function stripPort(host: string | null | undefined): string {
  if (!host) return ''
  // IPv6 with brackets: [::1]:3000
  if (host.startsWith('[')) {
    const closeBracket = host.indexOf(']')
    if (closeBracket === -1) return host
    // Return the address without brackets
    return host.slice(1, closeBracket)
  }
  // Regular host:port
  const colonIdx = host.lastIndexOf(':')
  if (colonIdx === -1) return host
  // Only strip if what's after the colon looks like a port number
  const maybPort = host.slice(colonIdx + 1)
  if (/^\d+$/.test(maybPort)) {
    return host.slice(0, colonIdx)
  }
  return host
}

/**
 * Is `host` a subdomain of `domain`?
 * Both may include ports — ports are stripped before comparison.
 * isSubdomainOf("acme.learnhouse.io:3000", "learnhouse.io") -> true
 * isSubdomainOf("learnhouse.io", "learnhouse.io") -> false (same host, not a subdomain)
 */
export function isSubdomainOf(host: string | null | undefined, domain: string): boolean {
  const h = stripPort(host).toLowerCase()
  const d = stripPort(domain).toLowerCase()
  if (!h || !d) return false
  return h.endsWith(`.${d}`)
}

/**
 * Same hostname ignoring port?
 * isSameHost("localhost:3000", "localhost") -> true
 * isSameHost("acme.io:8080", "acme.io:3000") -> true
 */
export function isSameHost(a: string | null | undefined, b: string | null | undefined): boolean {
  const ha = stripPort(a).toLowerCase()
  const hb = stripPort(b).toLowerCase()
  if (!ha || !hb) return false
  return ha === hb
}

/**
 * Extract subdomain from host given a parent domain.
 * Both may include ports — ports are stripped before comparison.
 * extractSubdomain("acme.learnhouse.io:3000", "learnhouse.io") -> "acme"
 * extractSubdomain("learnhouse.io", "learnhouse.io") -> null
 * extractSubdomain("localhost", "learnhouse.io") -> null
 */
export function extractSubdomain(host: string | null | undefined, domain: string): string | null {
  const h = stripPort(host).toLowerCase()
  const d = stripPort(domain).toLowerCase()
  if (!h || !d) return null
  const suffix = `.${d}`
  if (h.endsWith(suffix) && h.length > suffix.length) {
    return h.slice(0, h.length - suffix.length)
  }
  return null
}

/**
 * Is the host an IP address (v4 or v6)?
 * Port is stripped before checking.
 */
export function isIPAddress(host: string | null | undefined): boolean {
  const h = stripPort(host)
  if (!h) return false
  // IPv4: digits and dots only (e.g. 10.108.2.55, 127.0.0.1)
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true
  // IPv6: contains colons (e.g. ::1, fe80::1)
  if (h.includes(':')) return true
  return false
}

/**
 * Is host localhost, 127.0.0.1, or ::1?
 * Port is stripped before checking.
 */
export function isLocalhost(host: string | null | undefined): boolean {
  const h = stripPort(host).toLowerCase()
  if (!h) return false
  return h === 'localhost' || h === '127.0.0.1' || h === '::1'
}
