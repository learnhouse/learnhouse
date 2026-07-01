import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getConfig } from '@services/config/config'
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  ACCESS_TOKEN_MAX_AGE,
  REFRESH_TOKEN_MAX_AGE,
  getDomainFromRequest,
  getCookieOptions,
} from '@services/auth/cookies'
import { isLocalhost } from '@services/utils/ts/hostUtils'

const BACKEND_URL = (getConfig('NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL') || 'http://localhost:1338').replace(/\/+$/, '')

// Paths that return tokens in response body (relative to /api/v1/auth/)
// `verify-email` auto-signs-in the user on successful email verification, so
// it returns tokens just like login/signup and its cookies must be mirrored.
const TOKEN_RESPONSE_PATHS = ['login', 'refresh', 'oauth', 'signup', 'verify-email']

function shouldExtractTokens(path: string): boolean {
  return TOKEN_RESPONSE_PATHS.some(p => path.startsWith(p))
}

// Decode a JWT payload without verifying the signature. Used purely to read
// the `exp` claim so we can skip a slow backend refresh when the access token
// is still valid. If the backend later rejects the token (revoked, etc.), the
// next API call will 401 and the client will trigger a real refresh.
function decodeJwtExpiryMs(token: string): number | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    // JWT base64url -> base64
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padding = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
    const json = Buffer.from(padded + padding, 'base64').toString('utf-8')
    const payload = JSON.parse(json)
    if (typeof payload.exp !== 'number') return null
    return payload.exp * 1000
  } catch {
    return null
  }
}

// Skip the backend refresh roundtrip when the cookie token still has plenty
// of life left. Two minutes of headroom keeps us safe against clock skew.
const REFRESH_FAST_PATH_HEADROOM_MS = 2 * 60 * 1000

// Clear every auth + instance cookie in BOTH its domain-scoped (.{top_domain})
// and host-only variants. The browser can hold two cookies with the same name
// but different Domain attributes; clearing only one leaves the stale one to
// keep being sent — the user appears logged in with a dead token ("cookie
// staling").
//
// Crucially, the domain-scoped attribute is derived from env/host (via
// getDomainFromRequest), NOT from the LH_tenancy cookie: on a browser-restart-
// then-logout, LH_tenancy can be absent, and gating the domain clear on it
// (the old getCookieDomain path) left a multi-tenant session's .{top}-scoped
// 30-day refresh cookie alive forever. We always attempt both variants.
//
// We clear exactly the SESSION-sensitive cookies: the httpOnly auth tokens, the
// "session exists" marker (LH_session), the current-org marker (LH_org), and the
// per-session custom-domain marker. We deliberately do NOT clear the instance
// metadata cookies (LH_tenancy/LH_mode/LH_top_domain/LH_frontend_domain/
// LH_default_org) — those describe the deployment, are non-sensitive, are needed
// by anonymous visitors, and the proxy re-sets them on the very next request, so
// clearing them is both pointless and would briefly break tenancy resolution.
const CLEAR_HTTPONLY = [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, 'LH_custom_domain']
const CLEAR_MARKERS = ['LH_session', 'LH_org']

function appendClearAuthCookies(response: NextResponse, request: NextRequest) {
  const securePart = request.nextUrl.protocol === 'https:' ? '; Secure' : ''
  const host = request.headers.get('host') || ''
  const { topDomain } = getDomainFromRequest(request)
  const domainScoped =
    !isLocalhost(host) && topDomain && topDomain !== 'localhost' ? `.${topDomain}` : undefined

  const clear = (name: string, httpOnly: boolean, domain?: string) => {
    const httpPart = httpOnly ? '; HttpOnly' : ''
    const domainPart = domain ? `; Domain=${domain}` : ''
    response.headers.append(
      'Set-Cookie',
      `${name}=; Path=/${domainPart}; Max-Age=0${httpPart}; SameSite=Lax${securePart}`,
    )
  }

  for (const n of CLEAR_HTTPONLY) {
    clear(n, true)
    if (domainScoped) clear(n, true, domainScoped)
  }
  for (const n of CLEAR_MARKERS) {
    clear(n, false)
    if (domainScoped) clear(n, false, domainScoped)
  }
}

async function proxyRequest(
  request: NextRequest,
  method: string
): Promise<NextResponse> {
  // Extract the path after /api/auth/
  const pathSegments = request.nextUrl.pathname.replace('/api/auth/', '')
  const search = request.nextUrl.search

  // Map to backend URL: /api/auth/login -> /api/v1/auth/login
  const backendUrl = `${BACKEND_URL}/api/v1/auth/${pathSegments}${search}`

  // Build headers
  const headers: HeadersInit = {}
  const cookieStore = await cookies()

  // Forward content-type
  const contentType = request.headers.get('content-type')
  if (contentType) {
    headers['Content-Type'] = contentType
  }

  // Forward authorization header if present
  const authHeader = request.headers.get('authorization')
  if (authHeader) {
    headers['Authorization'] = authHeader
  }

  // Forward cookies to backend
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)
  const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)

  // Short-circuit: no refresh token cookie means nothing to refresh. Clear the
  // stale LH_session marker (and any orphaned cookies) too — otherwise the
  // client keeps seeing "a session exists" and loops on failed refreshes.
  if (pathSegments === 'refresh' && !refreshToken?.value) {
    const response = NextResponse.json({ error: 'No refresh token' }, { status: 401 })
    appendClearAuthCookies(response, request)
    return response
  }

  // Fast-path: if the access token cookie is present and isn't about to
  // expire, return it without round-tripping to the backend. Saves ~500ms+
  // on every cold page load where the cookie is still valid.
  if (
    pathSegments === 'refresh'
    && method === 'GET'
    && accessToken?.value
  ) {
    const expiryMs = decodeJwtExpiryMs(accessToken.value)
    if (expiryMs && expiryMs - Date.now() > REFRESH_FAST_PATH_HEADROOM_MS) {
      return NextResponse.json({
        access_token: accessToken.value,
        expiry: expiryMs,
      })
    }
  }

  // Handle logout locally — clear cookies and return 200
  // Try backend invalidation but don't fail if it errors
  if (pathSegments === 'logout' || pathSegments.endsWith('/logout')) {
    // Best-effort backend token invalidation
    try {
      const logoutHeaders: HeadersInit = {}
      if (refreshToken?.value) {
        logoutHeaders['Cookie'] = `${REFRESH_TOKEN_COOKIE}=${refreshToken.value}`
      }
      await fetch(`${BACKEND_URL}/api/v1/auth/logout`, {
        method: 'POST',
        headers: logoutHeaders,
        signal: AbortSignal.timeout(3000),
      }).catch(() => {})
    } catch {
      // Backend logout failed — that's fine, cookies are cleared below
    }

    const response = NextResponse.json({ ok: true })
    appendClearAuthCookies(response, request)
    return response
  }

  const cookieParts: string[] = []
  if (accessToken?.value) {
    cookieParts.push(`${ACCESS_TOKEN_COOKIE}=${accessToken.value}`)
  }
  if (refreshToken?.value) {
    cookieParts.push(`${REFRESH_TOKEN_COOKIE}=${refreshToken.value}`)
  }
  if (cookieParts.length > 0) {
    headers['Cookie'] = cookieParts.join('; ')
  }

  // Get request body for non-GET requests
  let body: BodyInit | undefined
  if (method !== 'GET' && method !== 'HEAD') {
    if (contentType?.includes('application/json')) {
      body = JSON.stringify(await request.json())
    } else if (contentType?.includes('application/x-www-form-urlencoded')) {
      const formData = await request.formData()
      const params = new URLSearchParams()
      formData.forEach((value, key) => {
        params.append(key, value.toString())
      })
      body = params.toString()
    } else if (contentType?.includes('multipart/form-data')) {
      delete headers['Content-Type']
      body = await request.formData()
    } else {
      body = await request.text()
    }
  }

  // Make the request to backend
  const backendResponse = await fetch(backendUrl, {
    method,
    headers,
    body,
  })

  // Get response data
  const responseContentType = backendResponse.headers.get('content-type')
  let responseData: any
  let responseBody: BodyInit

  if (responseContentType?.includes('application/json')) {
    responseData = await backendResponse.json()
    responseBody = JSON.stringify(responseData)
  } else {
    responseBody = await backendResponse.text()
  }

  // Create response
  const response = new NextResponse(responseBody, {
    status: backendResponse.status,
    statusText: backendResponse.statusText,
  })

  // Copy relevant headers
  if (responseContentType) {
    response.headers.set('content-type', responseContentType)
  }

  // Extract and set auth cookies if this is a token-returning endpoint
  if (backendResponse.ok && shouldExtractTokens(pathSegments) && responseData) {
    const cookieOptions = getCookieOptions(request)

    // Handle different response structures
    const tokens = responseData.tokens || responseData

    if (tokens.access_token) {
      response.cookies.set(ACCESS_TOKEN_COOKIE, tokens.access_token, {
        ...cookieOptions,
        maxAge: ACCESS_TOKEN_MAX_AGE,
      })
    }

    if (tokens.refresh_token) {
      response.cookies.set(REFRESH_TOKEN_COOKIE, tokens.refresh_token, {
        ...cookieOptions,
        maxAge: REFRESH_TOKEN_MAX_AGE,
      })
    }

    // Set a non-httpOnly marker so the client knows a session exists
    // without making a network request (the actual tokens stay httpOnly)
    if (tokens.access_token || tokens.refresh_token) {
      response.cookies.set('LH_session', '1', {
        ...cookieOptions,
        httpOnly: false,
        maxAge: REFRESH_TOKEN_MAX_AGE,
      })
    }
  }

  // A failed refresh means the refresh cookie is dead (revoked, expired, or a
  // replay outside the grace window). Clear all auth cookies so the browser
  // stops sending a stale 30-day refresh token + LH_session marker, which
  // would otherwise loop the client through repeated failed refreshes instead
  // of cleanly falling back to the login screen.
  if (pathSegments === 'refresh' && !backendResponse.ok) {
    appendClearAuthCookies(response, request)
  }

  return response
}

export async function GET(request: NextRequest) {
  return proxyRequest(request, 'GET')
}

export async function POST(request: NextRequest) {
  return proxyRequest(request, 'POST')
}

export async function PUT(request: NextRequest) {
  return proxyRequest(request, 'PUT')
}

export async function PATCH(request: NextRequest) {
  return proxyRequest(request, 'PATCH')
}

export async function DELETE(request: NextRequest) {
  return proxyRequest(request, 'DELETE')
}
