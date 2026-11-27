/**
 * The separate origin SCORM, Tin Can and cmi5 packages are served from.
 *
 * Package files are org-authored HTML and JavaScript. When
 * LEARNHOUSE_PACKAGE_CONTENT_URL names a host on its own registrable domain,
 * packages run there, where no session cookie is ever sent, instead of on the
 * org's site. Unset, packages are served on the org's site as before.
 *
 * Server-side only: the player learns the origin from the API.
 */

export function getPackageContentUrl(): string | null {
  const raw = (process.env.LEARNHOUSE_PACKAGE_CONTENT_URL || '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(raw)) return null
  try {
    return new URL(raw).origin
  } catch {
    return null
  }
}

/** The content origin's host (`host[:port]`, lowercase), or null. */
export function getPackageContentHost(): string | null {
  const url = getPackageContentUrl()
  return url ? new URL(url).host.toLowerCase() : null
}

/** Whether a request's Host header is the content origin. */
export function isPackageContentHost(host: string | null | undefined): boolean {
  const contentHost = getPackageContentHost()
  return !!contentHost && !!host && host.trim().toLowerCase() === contentHost
}

/**
 * Paths the content origin answers. Everything else there is a 404, so the
 * app's pages never render on a host that package code controls.
 */
export function isPackageContentPath(pathname: string): boolean {
  return (
    pathname === '/package-player' ||
    pathname.startsWith('/api/pkg/') ||
    pathname.startsWith('/api/xapi/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico'
  )
}
