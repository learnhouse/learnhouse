// Impersonation token helpers for the auth proxy (server side, no Next
// imports, so they can be tested on their own).
//
// The API renews the token on /auth/impersonation/status while the session is
// in use (same session, later expiry). The proxy then swaps the httpOnly
// LH_imp cookie for it, and the cookie always lives exactly as long as the
// token it holds.

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

/** Split a /status reply into what the page may see and a renewed token (if any). */
export function splitRenewal(data: unknown): { session: Record<string, unknown>; token: string | null } {
  if (!data || typeof data !== 'object') return { session: {}, token: null }
  const { token, token_expires_at: _exp, ...session } = data as Record<string, unknown>
  return { session, token: typeof token === 'string' && token ? token : null }
}

/** The API answered that the session is over (as opposed to unreachable or busy). */
export function sessionIsOver(status: number): boolean {
  return status === 401 || status === 404 || status === 410
}
