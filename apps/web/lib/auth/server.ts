import { cookies } from 'next/headers'

const BACKEND_URL = (process.env.NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL || 'http://localhost:1338').replace(/\/+$/, '')

// Cookie names (must match the API routes)
const ACCESS_TOKEN_COOKIE = 'access_token_cookie'
const REFRESH_TOKEN_COOKIE = 'refresh_token_cookie'

// Types matching the client-side session structure
export interface Session {
  user: any | undefined
  roles?: string[] | undefined
  tokens?: {
    access_token?: string | undefined
    refresh_token?: string | undefined
    expiry?: number | undefined
  } | undefined
}

/**
 * Get server-side session by reading tokens from cookies.
 *
 * Since cookies are now set by Next.js API routes (same origin),
 * they are reliably readable by the Next.js server.
 */
export async function getServerSession(): Promise<Session | null> {
  try {
    const cookieStore = await cookies()

    // Try to get access token directly
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

      // Access token expired or invalid, try refresh
      console.log('[SERVER_SESSION] Access token invalid, trying refresh')
    }

    // Try to refresh using refresh token
    const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)

    if (!refreshToken?.value) {
      return null
    }

    // Exchange refresh token for new access token via backend
    const refreshResponse = await fetch(`${BACKEND_URL}/api/v1/auth/refresh`, {
      method: 'GET',
      headers: {
        Cookie: `${REFRESH_TOKEN_COOKIE}=${refreshToken.value}`,
      },
      cache: 'no-store',
    })

    if (!refreshResponse.ok) {
      console.log('[SERVER_SESSION] Refresh failed:', refreshResponse.status)
      return null
    }

    const refreshData = await refreshResponse.json()

    if (!refreshData.access_token) {
      return null
    }

    // Fetch user session with the new access token
    const sessionResponse = await fetch(`${BACKEND_URL}/api/v1/users/session`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${refreshData.access_token}`,
      },
      cache: 'no-store',
    })

    if (!sessionResponse.ok) {
      // Return minimal session with just the token
      return {
        user: undefined,
        roles: [],
        tokens: {
          access_token: refreshData.access_token,
          expiry: refreshData.expiry,
        },
      }
    }

    const sessionData = await sessionResponse.json()

    return {
      user: sessionData.user,
      roles: sessionData.roles,
      tokens: {
        access_token: refreshData.access_token,
        expiry: refreshData.expiry,
      },
    }
  } catch (error) {
    console.error('[SERVER_SESSION] Error:', error)
    return null
  }
}

/**
 * Get access token from cookies for server-side API calls.
 * This is a lightweight alternative when you only need the token.
 */
export async function getServerAccessToken(): Promise<string | null> {
  try {
    const cookieStore = await cookies()

    // Try access token first
    const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)
    if (accessToken?.value) {
      return accessToken.value
    }

    // Try to refresh
    const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)
    if (!refreshToken?.value) {
      return null
    }

    const response = await fetch(`${BACKEND_URL}/api/v1/auth/refresh`, {
      method: 'GET',
      headers: {
        Cookie: `${REFRESH_TOKEN_COOKIE}=${refreshToken.value}`,
      },
      cache: 'no-store',
    })

    if (!response.ok) {
      return null
    }

    const data = await response.json()
    return data.access_token || null
  } catch (error) {
    console.error('[SERVER_SESSION] Error getting access token:', error)
    return null
  }
}
