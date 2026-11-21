// Self-hosted Enterprise license lock: the rules shared by the proxy (which
// swaps every page for the lock screen while /instance/info says
// `license_locked`) and the browser (which shows the same screen the moment an
// API call answers 423). Pure and dependency-free so the proxy can import it
// and tests can call it directly.

/** Where the proxy rewrites a locked page. A root route, outside /orgs. */
export const LICENSE_LOCKED_PATH = '/license-locked'

export const LICENSE_LOCKED_EVENT = 'learnhouse:license-locked'

/** HTTP status the API answers with while the platform is locked. */
export const LICENSE_LOCKED_STATUS = 423

/**
 * What the proxy does with a request while the platform is locked:
 * - 'pass': serve it as usual (the login page and what signing in needs)
 * - 'page': render the lock screen in its place
 * - 'status': a feed or a machine-read file; answer a bare 423
 */
export type LicenseLockAction = 'pass' | 'page' | 'status'

// Signing in stays possible, as the contract asks. That needs the login page
// itself and the callbacks a sign-in finishes through (SSO, magic links, the
// cross-domain bridge). Health checks keep working so Kubernetes doesn't
// restart a pod that is only locked.
const EXEMPT_EXACT = new Set([
  '/login',
  '/auth/login',
  '/backoffice/login',
  '/auth/magic',
  '/redirect_from_auth',
])
const EXEMPT_PREFIXES = ['/auth/sso/', '/auth/callback/', '/auth/token-exchange', '/health']

// Feeds, sitemaps, robots.txt, llms.txt, manifests, IndexNow keys: anything
// read by a machine gets a status code, not an HTML page.
const MACHINE_PATH = /\.[A-Za-z0-9]{2,12}$|^\/podcast\/.+\/feed$|^\/course\/[^/]+\/updates\/feed$/

export function licenseLockAction(pathname: string): LicenseLockAction {
  const path = (pathname || '/').toLowerCase().replace(/\/+$/, '') || '/'
  if (EXEMPT_EXACT.has(path)) return 'pass'
  if (EXEMPT_PREFIXES.some((p) => path === p.replace(/\/$/, '') || path.startsWith(p))) return 'pass'
  if (MACHINE_PATH.test(path)) return 'status'
  return 'page'
}

/** Whether the browser should leave this page alone on a 423 (the login page). */
export function isLicenseLockExemptPage(pathname: string): boolean {
  return licenseLockAction(pathname) === 'pass'
}

/**
 * Whether an API error body is the license lock. The contract body is
 * `{ error: 'license_locked', reason }`; a FastAPI HTTPException would nest it
 * under `detail`, so both shapes count.
 */
export function isLicenseLockedBody(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, any>
  if (b.error === 'license_locked') return true
  const detail = b.detail
  if (detail === 'license_locked') return true
  return !!detail && typeof detail === 'object' && detail.error === 'license_locked'
}

/** Tell the page the platform is locked (see LicenseLockGate). */
export function dispatchLicenseLocked() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(LICENSE_LOCKED_EVENT))
}
