import { cookies } from 'next/headers'
import { getServerAPIUrl } from '@services/config/config'

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
 * Get server-side session by reading refresh token from cookies
 * and exchanging it for an access token.
 *
 * This is the server-side equivalent of useSession() for use in
 * Server Components and API routes.
 */
export async function getServerSession(): Promise<Session | null> {
  try {
    const cookieStore = await cookies()
    const refreshToken = cookieStore.get('refresh_token_cookie')

    if (!refreshToken?.value) {
      return null
    }

    // Exchange refresh token for access token
    const response = await fetch(`${getServerAPIUrl()}auth/refresh`, {
      method: 'GET',
      headers: {
        Cookie: `refresh_token_cookie=${refreshToken.value}`,
      },
      cache: 'no-store', // Don't cache auth requests
    })

    if (!response.ok) {
      return null
    }

    const data = await response.json()

    if (!data.access_token) {
      return null
    }

    // Fetch user session with the new access token
    const sessionResponse = await fetch(`${getServerAPIUrl()}users/session`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${data.access_token}`,
      },
      cache: 'no-store',
    })

    if (!sessionResponse.ok) {
      // Return minimal session with just the token
      return {
        user: undefined,
        roles: [],
        tokens: {
          access_token: data.access_token,
          expiry: data.expiry,
        },
      }
    }

    const sessionData = await sessionResponse.json()

    return {
      user: sessionData.user,
      roles: sessionData.roles,
      tokens: {
        access_token: data.access_token,
        expiry: data.expiry,
      },
    }
  } catch (error) {
    console.error('Server session error:', error)
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
    const refreshToken = cookieStore.get('refresh_token_cookie')

    if (!refreshToken?.value) {
      return null
    }

    const response = await fetch(`${getServerAPIUrl()}auth/refresh`, {
      method: 'GET',
      headers: {
        Cookie: `refresh_token_cookie=${refreshToken.value}`,
      },
      cache: 'no-store',
    })

    if (!response.ok) {
      return null
    }

    const data = await response.json()
    return data.access_token || null
  } catch (error) {
    console.error('Server access token error:', error)
    return null
  }
}
