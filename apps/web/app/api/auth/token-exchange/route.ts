import { NextRequest, NextResponse } from 'next/server'
import { getConfig } from '@services/config/config'
import { isSubdomainOf, isSameHost, isLocalhost, stripPort } from '@services/utils/ts/hostUtils'

const BACKEND_URL = (getConfig('NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL') || 'http://localhost:1338').replace(/\/+$/, '')

const ACCESS_TOKEN_COOKIE = 'access_token_cookie'
const REFRESH_TOKEN_COOKIE = 'refresh_token_cookie'
const ACCESS_TOKEN_MAX_AGE = 8 * 60 * 60
const REFRESH_TOKEN_MAX_AGE = 30 * 24 * 60 * 60

/**
 * Use the same cookie domain logic as the main auth proxy
 * so cookies behave identically to a normal login.
 */
function getCookieDomain(request: NextRequest): string | undefined {
  const host = request.headers.get('host')
  const envDomain = getConfig('NEXT_PUBLIC_LEARNHOUSE_DOMAIN')
  const envTopDomain = getConfig('NEXT_PUBLIC_LEARNHOUSE_TOP_DOMAIN')

  const domain = envDomain || request.cookies.get('learnhouse_frontend_domain')?.value || 'localhost'
  const topDomain = stripPort(envTopDomain || request.cookies.get('learnhouse_top_domain')?.value || domain)

  if (isLocalhost(host)) return undefined
  if (topDomain === 'localhost') return undefined
  if (isSubdomainOf(host, domain) || isSameHost(host, domain)) {
    return `.${topDomain}`
  }
  return undefined
}

function getCookieOptions(request: NextRequest) {
  const isSecure = request.nextUrl.protocol === 'https:'
  const domain = getCookieDomain(request)
  return {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax' as const,
    path: '/',
    ...(domain ? { domain } : {}),
  }
}

/**
 * Accepts tokens and sets them as cookies — identical to how
 * the main auth proxy sets cookies after a normal login.
 */
export async function POST(request: NextRequest) {
  try {
    const { token, refresh } = await request.json()
    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 })
    }

    // Validate the access token against the shared backend
    const sessionRes = await fetch(`${BACKEND_URL}/api/v1/users/session`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    })

    if (!sessionRes.ok) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const cookieOptions = getCookieOptions(request)
    const response = NextResponse.json({ ok: true })

    response.cookies.set(ACCESS_TOKEN_COOKIE, token, {
      ...cookieOptions,
      maxAge: ACCESS_TOKEN_MAX_AGE,
    })

    if (refresh && typeof refresh === 'string') {
      response.cookies.set(REFRESH_TOKEN_COOKIE, refresh, {
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
