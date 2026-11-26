// Impersonation token helpers for the auth proxy (server side, no Next
// imports, so they can be tested on their own).
//
// A token expires at its session's absolute cap (stored on the session when
// it starts, never re-minted); the httpOnly LH_imp cookie lives exactly as
// long as the token it holds.

/** Used only when a token carries no readable expiry (the API refuses those anyway). */
export const IMPERSONATION_COOKIE_FALLBACK_MAX_AGE = 12 * 60 * 60

/** A JWT's claims, unverified (the API verifies; this only reads them). */
export function jwtClaims(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
    const claims = JSON.parse(json)
    return claims && typeof claims === 'object' ? claims : null
  } catch {
    return null
  }
}

export function jwtPurpose(token: string): string | null {
  const purpose = jwtClaims(token)?.purpose
  return typeof purpose === 'string' ? purpose : null
}

/** Seconds the LH_imp cookie should live: until the token itself expires. */
export function impersonationCookieMaxAge(token: string, nowMs: number = Date.now()): number {
  const exp = jwtClaims(token)?.exp
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return IMPERSONATION_COOKIE_FALLBACK_MAX_AGE
  return Math.max(0, Math.floor(exp - nowMs / 1000))
}

/** The API answered that the session is over (as opposed to unreachable or busy). */
export function sessionIsOver(status: number): boolean {
  return status === 401 || status === 404 || status === 410
}

export type ImpersonationCheck =
  | { state: 'active'; session: unknown }
  | { state: 'ended'; body: unknown }
  | { state: 'unknown' }

/**
 * Whether the impersonation in LH_imp is still live, as the API sees it.
 *
 * Only the API decides. Whether this host can see the staff member's own
 * LH_refresh says nothing: that cookie can be host-only on the console's
 * host, or shadowed by a stale copy on an org subdomain, while the staff
 * member is still signed in. Ending the session on that guess bounced staff
 * straight back to the console. The API already ends every session a staff
 * member opened when they sign out, and refuses one whose opener's sessions
 * were revoked.
 */
export async function checkImpersonation(
  fetchStatus: () => Promise<Response | null>,
): Promise<ImpersonationCheck> {
  let res: Response | null = null
  try {
    res = await fetchStatus()
  } catch {
    res = null
  }
  if (!res || (!res.ok && !sessionIsOver(res.status))) return { state: 'unknown' }
  let body: unknown = {}
  try {
    body = await res.json()
  } catch {
    body = {}
  }
  return res.ok ? { state: 'active', session: body } : { state: 'ended', body }
}
