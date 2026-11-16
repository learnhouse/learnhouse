// The readable `LH_session` marker tells the client a session exists before
// it spends a request restoring one (AuthContext skips the refresh without
// it, so anonymous visitors cost nothing). The tokens themselves are httpOnly
// and outlive any client-side clear: a tab that clears the marker (a shared
// `.{top_domain}` cookie, so one tab's clear reaches every subdomain) while
// the refresh cookie survives leaves the browser signed in for the server and
// anonymous for the client. Pages then wait forever for a token that is never
// requested (the activity editor sat on its skeleton with zero requests).
// The proxy sees the httpOnly cookies, so it puts the marker back.

export const SESSION_MARKER_COOKIE = 'LH_session'
const REFRESH_TOKEN_COOKIE = 'LH_refresh'
// Same lifetime the auth route gives the marker (the refresh token's)
const MARKER_MAX_AGE_S = 30 * 24 * 60 * 60

interface CookieReader {
  get(_name: string): { value?: string } | undefined
}

interface CookieWriter {
  set(_options: {
    name: string
    value: string
    path: string
    maxAge: number
    httpOnly: boolean
    sameSite: 'lax'
    secure: boolean
  }): unknown
}

/** True when the browser holds a refresh cookie but lost the readable marker. */
export function needsSessionMarker(cookies: CookieReader): boolean {
  return !!cookies.get(REFRESH_TOKEN_COOKIE)?.value && !cookies.get(SESSION_MARKER_COOKIE)?.value
}

/**
 * Puts the marker back on `response` when needed. Host-only: it is only a
 * hint for this host (a dead refresh cookie gets a 401 on the client's first
 * refresh, which clears both again), and the client and auth route clear both
 * the host-only and the domain-wide variant.
 */
export function healSessionMarker(
  request: { cookies: CookieReader; nextUrl: { protocol: string } },
  response: { cookies: CookieWriter },
): boolean {
  if (!needsSessionMarker(request.cookies)) return false
  response.cookies.set({
    name: SESSION_MARKER_COOKIE,
    value: '1',
    path: '/',
    maxAge: MARKER_MAX_AGE_S,
    httpOnly: false,
    sameSite: 'lax',
    secure: request.nextUrl.protocol === 'https:',
  })
  return true
}
