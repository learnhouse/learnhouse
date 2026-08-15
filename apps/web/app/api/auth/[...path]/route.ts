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
// `magic-link` covers /magic-link/verify, which mints a session (or an mfa_token)
// from a passwordless login link.
const TOKEN_RESPONSE_PATHS = ['login', 'refresh', 'oauth', 'signup', 'verify-email', 'magic-link']

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

// A refresh failure only justifies destroying the session when the backend
// rejected the CREDENTIAL itself. 401/403 are terminal — the refresh cookie is
// expired, revoked, or was flagged as replayed, and re-sending it will never
// work. Everything else (429 rate limit, 5xx during a deploy, gateway
// timeouts) is a server-side hiccup that says nothing about the token's
// validity, and the user's session must survive it.
function isTerminalAuthFailure(status: number): boolean {
  return status === 401 || status === 403
}

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

// Headers that identify the ORIGINAL caller, relayed to the backend untouched.
//
// This proxy is server-to-server: with nothing forwarded, the backend sees the
// Next.js pod as the client for EVERY request. Its per-IP limits — login
// (30/5min), signup (10/hour), refresh (600/min) — then share ONE bucket across
// the whole deployment instead of being per caller. A single person retrying a
// password could lock every user out of signing in, and the limits stop being
// brute-force protection at all because they cannot tell callers apart. The
// account-lockout bookkeeping records the attempting IP too, so it was logging
// this pod for every failed login.
//
// Relayed verbatim rather than parsed: the backend's get_client_ip already owns
// the chain-parsing rules (and only trusts these at all when the connection
// comes from a private address). Re-deriving a single IP here would mean the
// same header is interpreted two different ways in two places.
//
// NOTE: this inherits the deployment requirement the backend already documents
// — the ingress MUST overwrite, not append to, a client-supplied
// X-Forwarded-For. Otherwise a caller can prepend a fake IP and evade the
// limits. That requirement is unchanged by this proxy; it applies equally to
// requests that reach the API directly.
const CLIENT_IDENTITY_HEADERS = ['x-forwarded-for', 'x-real-ip', 'user-agent']

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

  // Forward the caller's IP. This proxy builds its headers from scratch, so
  // without this the backend only ever sees the Next.js server's own address:
  // every visitor collapses into a single per-IP rate-limit bucket and one busy
  // deployment locks everyone out of login and token refresh. The backend only
  // trusts these when the direct connection is from a private address (see
  // get_client_ip), so forwarding what the ingress already set is the same
  // contract the /api/v1 proxy honours by forwarding all headers.
  for (const ipHeader of ['x-forwarded-for', 'x-real-ip']) {
    const value = request.headers.get(ipHeader)
    if (value) headers[ipHeader] = value
  }

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

  for (const name of CLIENT_IDENTITY_HEADERS) {
    const value = request.headers.get(name)
    if (value) headers[name] = value
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
      // Both cookies must go: the backend identifies the session to revoke from
      // LH_access (Authorization header or the LH_access cookie — never
      // LH_refresh), so sending only the refresh cookie made every logout 401
      // and skipped server-side revocation entirely.
      const logoutCookieParts: string[] = []
      if (accessToken?.value) {
        logoutCookieParts.push(`${ACCESS_TOKEN_COOKIE}=${accessToken.value}`)
      }
      if (refreshToken?.value) {
        logoutCookieParts.push(`${REFRESH_TOKEN_COOKIE}=${refreshToken.value}`)
      }
      if (logoutCookieParts.length > 0) {
        logoutHeaders['Cookie'] = logoutCookieParts.join('; ')
      }
      if (authHeader) {
        logoutHeaders['Authorization'] = authHeader
      }
      // Backend logout is DELETE /auth/logout — using POST returned 405 and
      // silently skipped server-side session revocation, so revoked tokens
      // stayed valid until natural expiry. Match the contract and surface drift.
      const logoutRes = await fetch(`${BACKEND_URL}/api/v1/auth/logout`, {
        method: 'DELETE',
        headers: logoutHeaders,
        signal: AbortSignal.timeout(3000),
      }).catch(() => null)
      if (logoutRes && !logoutRes.ok) {
        console.warn(`[auth] backend logout returned ${logoutRes.status} — server session may not be revoked`)
      }
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

  // Only destroy the session when the backend says the refresh CREDENTIAL is
  // dead — 401 (expired/revoked/replayed) or 403. Those are terminal: the
  // cookie will never work again, so we clear it and let the client fall back
  // to the login screen instead of looping on failed refreshes.
  //
  // Every other failure is transient and MUST NOT log the user out. A 429 from
  // the per-IP refresh rate limit, a 502 while the API rolls out, a 500, a
  // gateway timeout — none of those mean the user's 30-day refresh token is
  // invalid. Clearing cookies on those was silently ending sessions that had
  // weeks of life left, and because the httpOnly refresh cookie was deleted
  // the user could not recover except by signing in again. Whole classrooms
  // behind one NAT IP were being signed out together this way.
  if (pathSegments === 'refresh' && isTerminalAuthFailure(backendResponse.status)) {
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
