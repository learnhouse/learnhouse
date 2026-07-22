import { cookies } from 'next/headers'

const BACKEND_URL = (process.env.NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL || 'http://localhost:1338').replace(/\/+$/, '')

// Cookie names (must match the API routes)
const ACCESS_TOKEN_COOKIE = 'LH_access'
const REFRESH_TOKEN_COOKIE = 'LH_refresh'

// Types matching the client-side session structure
export interface Session {
  user: any | undefined
  roles?: string[] | undefined
  tokens?: {
    access_token?: string | undefined
    refresh_token?: string | undefined
    expiry?: number | undefined
  } | undefined
  /**
   * True when a refresh cookie exists but the server could not turn it into an
   * access token without consuming it. The user is signed in; the server just
   * can't see who they are. Pages must NOT redirect to /login on this — render
   * and let the client hydrate the real session.
   */
  unresolved?: boolean
}

/**
 * Get server-side session by reading tokens from cookies.
 *
 * IMPORTANT — this must never call `/api/v1/auth/refresh`.
 *
 * Refresh tokens are one-time-use: the backend marks the presented `jti` as
 * consumed and returns a rotated replacement. A Server Component cannot set
 * cookies, so any refresh performed here consumes the browser's token and then
 * throws the replacement away. The browser keeps sending the dead token, and
 * once the backend's grace window lapses that looks exactly like a stolen
 * token being replayed — which revokes EVERY session the user has, on every
 * device. That is the "I was randomly logged out" report.
 *
 * So: use the access token if we have one, otherwise report the session as
 * unresolved and let the client restore it through `/api/auth/refresh`, which
 * is a Route Handler and *can* persist the rotation.
 */
export async function getServerSession(): Promise<Session | null> {
  try {
    const cookieStore = await cookies()

    const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)

    if (accessToken?.value) {
      // Verify the token is valid by fetching session from backend
      const sessionResponse = await fetch(`${BACKEND_URL}/api/v1/users/session`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken.value}`,
        },
        cache: 'no-store',
      })

      if (sessionResponse.ok) {
        const sessionData = await sessionResponse.json()
        return {
          user: sessionData.user,
          roles: sessionData.roles,
          tokens: {
            access_token: accessToken.value,
          },
        }
      }
    }

    // No usable access token. If a refresh cookie is present the user is still
    // signed in — we just can't prove it from here without burning the token.
    // Report an unresolved session so pages can avoid bouncing a logged-in
    // user to /login; the client resolves it on hydration.
    const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)
    if (refreshToken?.value) {
      return { user: undefined, roles: [], tokens: undefined, unresolved: true }
    }

    return null
  } catch (error) {
    console.error('[SERVER_SESSION] Error:', error)
    return null
  }
}

/**
 * Get access token from cookies for server-side API calls.
 * This is a lightweight alternative when you only need the token.
 *
 * Returns null rather than refreshing — see the note on `getServerSession`
 * about why a Server Component must not consume a one-time-use refresh token.
 * Callers should treat null as "render without personalised data" and let the
 * client fill it in.
 */
export async function getServerAccessToken(): Promise<string | null> {
  try {
    const cookieStore = await cookies()
    return cookieStore.get(ACCESS_TOKEN_COOKIE)?.value || null
  } catch (error) {
    console.error('[SERVER_SESSION] Error getting access token:', error)
    return null
  }
}
