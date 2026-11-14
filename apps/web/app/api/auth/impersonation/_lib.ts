import { NextRequest, NextResponse } from 'next/server'
import { getConfig } from '@services/config/config'
import { IMPERSONATION_COOKIE, getCookieOptions, getDomainFromRequest } from '@services/auth/cookies'
import { isLocalhost } from '@services/utils/ts/hostUtils'

// Shared by the impersonation route handlers (files prefixed with `_` are
// never routes).

export const BACKEND_URL = (getConfig('NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL') || 'http://localhost:1338').replace(/\/+$/, '')

function requestHosts(request: NextRequest): string[] {
  return [request.headers.get('x-forwarded-host'), request.headers.get('host')]
    .map((h) => (h || '').split(',')[0].trim().toLowerCase())
    .filter(Boolean)
}

export function isCrossSite(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  if (origin) {
    let host = ''
    try {
      host = new URL(origin).host.toLowerCase()
    } catch {
      /* "null" or malformed */
    }
    return !host || !requestHosts(request).includes(host)
  }
  const site = request.headers.get('sec-fetch-site')
  return site !== null && site !== 'same-origin' && site !== 'none'
}

export function forwardHeaders(request: NextRequest, token: string): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  for (const name of ['x-forwarded-for', 'x-real-ip', 'user-agent']) {
    const value = request.headers.get(name)
    if (value) headers[name] = value
  }
  return headers
}

export function clearCookie(response: NextResponse, request: NextRequest) {
  const secure = request.nextUrl.protocol === 'https:' ? '; Secure' : ''
  const base = `${IMPERSONATION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`
  response.headers.append('Set-Cookie', base)
  const host = request.headers.get('host') || ''
  const { topDomain } = getDomainFromRequest(request)
  if (!isLocalhost(host) && topDomain && topDomain !== 'localhost') {
    response.headers.append('Set-Cookie', `${base}; Domain=.${topDomain}`)
  }
}

export async function readJson(res: Response): Promise<any> {
  try {
    return await res.json()
  } catch {
    return {}
  }
}


/** Keep a freshly issued impersonation token in its httpOnly cookie. */
export function setCookie(response: NextResponse, request: NextRequest, token: string) {
  // The server ends an idle session after 8 h and any session after 12 h; the
  // cookie lasts as long as the token itself.
  response.cookies.set(IMPERSONATION_COOKIE, token, { ...getCookieOptions(request), maxAge: 12 * 60 * 60 })
}
