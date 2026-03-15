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
 * validates them against the shared backend, and sets cookies using the exact
 * same logic as the main auth proxy.
 */
export async function POST(request: NextRequest) {
  try {
    const { code } = await request.json()
    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'Missing code' }, { status: 400 })
    }

    // Server-to-server: exchange code for tokens from the platform
    const codeRes = await fetch(
      `${PLATFORM_URL}/api/auth/exchange-code?code=${encodeURIComponent(code)}`,
      { signal: AbortSignal.timeout(5000) }
    )

    if (!codeRes.ok) {
      return NextResponse.json({ error: 'Invalid or expired code' }, { status: 401 })
    }

    const { access_token, refresh_token } = await codeRes.json()
    if (!access_token) {
      return NextResponse.json({ error: 'No tokens returned' }, { status: 401 })
    }

    // Validate the access token against the shared backend
    const sessionRes = await fetch(`${BACKEND_URL}/api/v1/users/session`, {
      headers: { Authorization: `Bearer ${access_token}` },
      signal: AbortSignal.timeout(5000),
    })

    if (!sessionRes.ok) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    // Set cookies using the exact same logic as the main auth proxy
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
  } catch {
    return NextResponse.json({ error: 'Token exchange failed' }, { status: 500 })
  }
}
