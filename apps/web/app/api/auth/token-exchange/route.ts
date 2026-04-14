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
const PLATFORM_URL = (getConfig('NEXT_PUBLIC_LEARNHOUSE_PLATFORM_URL') || getConfig('LEARNHOUSE_PLATFORM_URL') || 'https://learnhouse.app').replace(/\/+$/, '')

const MAX_CODE_LENGTH = 4096
const PLATFORM_TIMEOUT_MS = 10_000
const BACKEND_TIMEOUT_MS = 5_000

// Fetch with one retry on transient errors (network errors, 5xx). Creates a
// FRESH timeout signal for each attempt — reusing the same signal would leave
// the retry with zero budget after the first attempt nearly timed out.
async function fetchWithRetry(
  url: string,
  init: Omit<RequestInit, 'signal'>,
  timeoutMs: number,
): Promise<Response> {
  const attempt = () => fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  try {
    const res = await attempt()
    if (res.status >= 500 && res.status < 600) {
      return await attempt()
    }
    return res
  } catch {
    return await attempt()
  }
}

// Extract the real client IP from the incoming request so backend rate limits
// apply per-user, not per-Next.js-pod.
function getClientIp(request: NextRequest): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp.trim()
  return ''
}

function backendHeaders(request: NextRequest, extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra }
  const ip = getClientIp(request)
  if (ip) {
    headers['X-Forwarded-For'] = ip
    headers['X-Real-IP'] = ip
  }
  const ua = request.headers.get('user-agent')
  if (ua) headers['User-Agent'] = ua
  return headers
}

// CSRF defense. Compare HOST, not full origin — protocol detection behind a
// TLS-terminating proxy is unreliable (nextUrl.protocol depends on whether
// X-Forwarded-Proto is forwarded). The host check alone is sufficient because
// a cross-origin attacker cannot spoof the browser-set Origin header.
function isSameOrigin(request: NextRequest): boolean {
  const expectedHost = request.headers.get('host')
  if (!expectedHost) return false

  const getHost = (value: string | null): string | null => {
    if (!value) return null
    try {
      return new URL(value).host
    } catch {
      return null
    }
  }

  const originHost = getHost(request.headers.get('origin'))
  if (originHost !== null) return originHost === expectedHost

  // Some clients (e.g. same-origin fetches in certain browsers) omit Origin
  // on GET but still send Referer; accept Referer as a weaker fallback.
  const refererHost = getHost(request.headers.get('referer'))
  if (refererHost !== null) return refererHost === expectedHost

  return false
}

/**
 * Exchange a platform-issued code for a tenant-side session.
 *
 * Flow:
 *   1. Decrypt the code via the platform to get {access_token, refresh_token}.
 *   2. If we have a refresh_token, exchange it on THIS backend for a fresh
 *      access_token — this catches a JWT-secret mismatch loudly.
 *   3. ALWAYS validate the resulting access_token against /users/session —
 *      refresh only checks the JWT signature, not user existence, so a valid
 *      signature for a user missing on this tenant would otherwise produce a
 *      silent half-logged-in state (cookies set → /session 401 on next page).
 *   4. Set cookies and return.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isSameOrigin(request)) {
      return NextResponse.json(
        { error: 'Forbidden', code: 'bad_origin' },
        { status: 403 }
      )
    }

    if (!request.headers.get('content-type')?.includes('application/json')) {
      return NextResponse.json(
        { error: 'Expected application/json', code: 'bad_content_type' },
        { status: 400 }
      )
    }

    const body = await request.json().catch(() => null)
    const code = body?.code
    if (!code || typeof code !== 'string' || code.length > MAX_CODE_LENGTH) {
      return NextResponse.json(
        { error: 'Missing or invalid code', code: 'missing_code' },
        { status: 400 }
      )
    }

    // Step 1: Decrypt the code via the platform
    let codeRes: Response
    try {
      codeRes = await fetchWithRetry(
        `${PLATFORM_URL}/api/auth/exchange-code?code=${encodeURIComponent(code)}`,
        {},
        PLATFORM_TIMEOUT_MS,
      )
    } catch (err) {
      console.error(`[token-exchange] step=decrypt platform=${PLATFORM_URL} unreachable:`, err)
      return NextResponse.json(
        { error: 'Could not reach the platform', code: 'platform_unreachable' },
        { status: 502 }
      )
    }

    if (!codeRes.ok) {
      const detail = await codeRes.text().catch(() => '')
      console.error(`[token-exchange] step=decrypt failed: ${codeRes.status} ${detail}`)
      return NextResponse.json(
        { error: 'This sign-in link has expired or already been used', code: 'code_expired' },
        { status: 401 }
      )
    }

    const payload = await codeRes.json().catch(() => null)
    if (!payload || typeof payload !== 'object') {
      console.error('[token-exchange] step=decrypt unparseable body')
      return NextResponse.json(
        { error: 'Platform returned invalid response', code: 'platform_bad_response' },
        { status: 502 }
      )
    }

    let access_token: string = typeof payload.access_token === 'string' ? payload.access_token : ''
    const refresh_token: string = typeof payload.refresh_token === 'string' ? payload.refresh_token : ''

    if (!access_token && !refresh_token) {
      console.error('[token-exchange] step=decrypt no tokens in response')
      return NextResponse.json(
        { error: 'No tokens returned', code: 'no_tokens' },
        { status: 401 }
      )
    }

    // Step 2: If we have a refresh token, mint a fresh access_token on THIS
    // backend. This is the first chance to detect a JWT-secret mismatch.
    if (refresh_token) {
      try {
        const refreshRes = await fetchWithRetry(
          `${BACKEND_URL}/api/v1/auth/refresh`,
          {
            method: 'GET',
            headers: backendHeaders(request, {
              Cookie: `${REFRESH_TOKEN_COOKIE}=${refresh_token}`,
            }),
          },
          BACKEND_TIMEOUT_MS,
        )
        if (refreshRes.ok) {
          const refreshData = await refreshRes.json().catch(() => null)
          if (refreshData?.access_token && typeof refreshData.access_token === 'string') {
            access_token = refreshData.access_token
          } else {
            console.error('[token-exchange] step=refresh response missing access_token')
          }
        } else {
          const detail = await refreshRes.text().catch(() => '')
          console.error(`[token-exchange] step=refresh failed: ${refreshRes.status} ${detail}`)
          // Non-fatal: we'll fall through to /session validation with the
          // original access_token. If that's also invalid we bail there.
        }
      } catch (err) {
        console.error('[token-exchange] step=refresh errored:', err)
      }
    }

    if (!access_token) {
      return NextResponse.json(
        { error: 'Token exchange failed', code: 'no_access_token' },
        { status: 401 }
      )
    }

    // Step 3: ALWAYS validate via /session. Refresh only checks the JWT
    // signature — this call also confirms the user exists on THIS tenant, so
    // we never set cookies for a half-logged-in state.
    let sessionRes: Response
    try {
      sessionRes = await fetchWithRetry(
        `${BACKEND_URL}/api/v1/users/session`,
        {
          headers: backendHeaders(request, {
            Authorization: `Bearer ${access_token}`,
          }),
        },
        BACKEND_TIMEOUT_MS,
      )
    } catch (err) {
      console.error('[token-exchange] step=session errored:', err)
      return NextResponse.json(
        { error: 'Could not reach backend', code: 'backend_unreachable' },
        { status: 502 }
      )
    }

    if (!sessionRes.ok) {
      const detail = await sessionRes.text().catch(() => '')
      console.error(`[token-exchange] step=session failed: ${sessionRes.status} ${detail}`)
      // Backend semantics (see src/security/auth.py + services/users/users.py):
      //   401 → get_current_user rejected the token. Happens when the JWT is
      //         valid but the user row is missing on this tenant, or when the
      //         token has a non-session purpose claim.
      //   400 → get_current_user returned AnonymousUser (token could not be
      //         decoded — bad signature, expired, or malformed), then
      //         get_user_session raised "User does not exist".
      if (sessionRes.status === 401) {
        return NextResponse.json(
          { error: 'Your account does not exist on this organization', code: 'user_not_in_tenant' },
          { status: 401 }
        )
      }
      return NextResponse.json(
        { error: 'Could not validate session on this tenant', code: 'session_invalid' },
        { status: 401 }
      )
    }

    // Step 4: Set cookies. If the platform didn't give us a refresh_token,
    // reject instead of setting a half-broken session that AuthContext cannot
    // refresh (it always calls /api/auth/refresh on mount).
    if (!refresh_token) {
      console.error('[token-exchange] step=cookies no refresh token — refusing to set partial session')
      return NextResponse.json(
        { error: 'Platform did not return a refresh token', code: 'no_refresh_token' },
        { status: 401 }
      )
    }

    const cookieOptions = getCookieOptions(request)
    const response = NextResponse.json({ ok: true })

    response.cookies.set(ACCESS_TOKEN_COOKIE, access_token, {
      ...cookieOptions,
      maxAge: ACCESS_TOKEN_MAX_AGE,
    })
    response.cookies.set(REFRESH_TOKEN_COOKIE, refresh_token, {
      ...cookieOptions,
      maxAge: REFRESH_TOKEN_MAX_AGE,
    })
    response.cookies.set('learnhouse_has_session', '1', {
      ...cookieOptions,
      httpOnly: false,
      maxAge: REFRESH_TOKEN_MAX_AGE,
    })

    return response
  } catch (err) {
    console.error('[token-exchange] unexpected error:', err)
    return NextResponse.json(
      { error: 'Token exchange failed', code: 'unexpected' },
      { status: 500 }
    )
  }
}
