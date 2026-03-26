import { NextRequest, NextResponse } from 'next/server'
import { getConfig } from '@services/config/config'
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  ACCESS_TOKEN_MAX_AGE,
  REFRESH_TOKEN_MAX_AGE,
  getCookieOptions,
} from '@services/auth/cookies'

const BACKEND_URL = (getConfig('NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL') || 'http://localhost:1338').replace(/\/+$/, '')
const PLATFORM_URL = (getConfig('LEARNHOUSE_PLATFORM_URL') || 'https://learnhouse.app').replace(/\/+$/, '')

/**
 * Accepts an exchange code, fetches tokens from the platform (server-to-server),
 * obtains a fresh token pair from the backend, and sets cookies.
 *
 * The key insight: the web app's AuthContext init ONLY tries refreshAccessToken()
 * on mount — it never uses the access_token cookie directly. So we MUST ensure
 * the refresh_token_cookie is set and valid, otherwise the user gets bounced to login.
 */
export async function POST(request: NextRequest) {
  try {
    const { code } = await request.json()
    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'Missing code' }, { status: 400 })
    }

    // Step 1: Exchange code for tokens from the platform (server-to-server)
    const codeRes = await fetch(
      `${PLATFORM_URL}/api/auth/exchange-code?code=${encodeURIComponent(code)}`,
      { signal: AbortSignal.timeout(10000) }
    )

    if (!codeRes.ok) {
      const detail = await codeRes.text().catch(() => '')
      console.error(`[token-exchange] Code exchange failed: ${codeRes.status} ${detail}`)
      return NextResponse.json({ error: 'Invalid or expired code' }, { status: 401 })
    }

    let { access_token, refresh_token } = await codeRes.json()
    if (!access_token) {
      console.error('[token-exchange] No access_token in exchange response')
      return NextResponse.json({ error: 'No tokens returned' }, { status: 401 })
    }

    // Step 2: If we have a refresh token, use it to get a guaranteed-fresh
    // access token from the backend. This is critical because AuthContext init
    // calls /api/auth/refresh first — if that fails, the user is unauthenticated.
    if (refresh_token) {
      try {
        const refreshRes = await fetch(`${BACKEND_URL}/api/v1/auth/refresh`, {
          method: 'GET',
          headers: { Cookie: `${REFRESH_TOKEN_COOKIE}=${refresh_token}` },
          signal: AbortSignal.timeout(5000),
        })
        if (refreshRes.ok) {
          const refreshData = await refreshRes.json()
          if (refreshData.access_token) {
            access_token = refreshData.access_token
          }
        }
      } catch {
        // Refresh failed — use the original access token
      }
    }

    // Step 3: Validate the access token against the backend
    const sessionRes = await fetch(`${BACKEND_URL}/api/v1/users/session`, {
      headers: { Authorization: `Bearer ${access_token}` },
      signal: AbortSignal.timeout(5000),
    })

    if (!sessionRes.ok) {
      // Access token invalid. If we have a refresh token, try refreshing
      // (handles the case where the original access token was expired
      // but the refresh token is still valid)
      if (refresh_token) {
        try {
          const retryRefresh = await fetch(`${BACKEND_URL}/api/v1/auth/refresh`, {
            method: 'GET',
            headers: { Cookie: `${REFRESH_TOKEN_COOKIE}=${refresh_token}` },
            signal: AbortSignal.timeout(5000),
          })
          if (retryRefresh.ok) {
            const retryData = await retryRefresh.json()
            if (retryData.access_token) {
              access_token = retryData.access_token
            } else {
              console.error('[token-exchange] Session validation failed and refresh returned no token')
              return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
            }
          } else {
            console.error(`[token-exchange] Session validation and refresh both failed`)
            return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
          }
        } catch {
          console.error('[token-exchange] Session validation failed and refresh errored')
          return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
        }
      } else {
        console.error('[token-exchange] Session validation failed and no refresh token available')
        return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
      }
    }

    // Step 4: Set cookies
    const cookieOptions = getCookieOptions(request)
    const response = NextResponse.json({ ok: true })

    response.cookies.set(ACCESS_TOKEN_COOKIE, access_token, {
      ...cookieOptions,
      maxAge: ACCESS_TOKEN_MAX_AGE,
    })

    if (refresh_token) {
      response.cookies.set(REFRESH_TOKEN_COOKIE, refresh_token, {
        ...cookieOptions,
        maxAge: REFRESH_TOKEN_MAX_AGE,
      })
    }

    response.cookies.set('learnhouse_has_session', '1', {
      ...cookieOptions,
      httpOnly: false,
      maxAge: REFRESH_TOKEN_MAX_AGE,
    })

    return response
  } catch (err) {
    console.error('[token-exchange] Unexpected error:', err)
    return NextResponse.json({ error: 'Token exchange failed' }, { status: 500 })
  }
}
