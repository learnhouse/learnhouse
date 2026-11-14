import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ACCESS_TOKEN_COOKIE, IMPERSONATION_COOKIE } from '@services/auth/cookies'
import { BACKEND_URL, clearCookie, forwardHeaders, isCrossSite, readJson, setCookie } from './_lib'

// Impersonation, browser side.
//
//   POST   start: the console (or an org page a staff member opened) asks the
//          API with the superadmin's own session; the returned token goes into
//          the httpOnly LH_imp cookie. The superadmin's own LH_access /
//          LH_refresh stay untouched, so ending is just dropping LH_imp.
//   GET    status of the impersonation this browser holds (badge, other tabs).
//   DELETE end it (server-side record first, then the cookie).
//   ./switch, ./targets: the badge's menu.
//
// Same-origin only for the state-changing verbs (the API's own CSRF check
// can't see the browser's Origin through this proxy).

export async function POST(request: NextRequest) {
  if (isCrossSite(request)) {
    return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 })
  }
  // The console's own token (it holds a fresh one), else its cookie.
  const auth = request.headers.get('authorization') || ''
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  const token = bearer || (await cookies()).get(ACCESS_TOKEN_COOKIE)?.value
  if (!token || token.toLowerCase().startsWith('lh_')) {
    return NextResponse.json({ detail: 'Sign in to the console first' }, { status: 401 })
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ detail: 'Invalid request' }, { status: 400 })
  }
  let res: Response
  try {
    res = await fetch(`${BACKEND_URL}/api/v1/ee/superadmin/impersonations`, {
      method: 'POST',
      headers: { ...forwardHeaders(request, token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
  } catch {
    return NextResponse.json({ detail: 'The API could not be reached' }, { status: 502 })
  }
  const data = await readJson(res)
  if (!res.ok || typeof data?.token !== 'string') {
    return NextResponse.json(data && typeof data === 'object' ? data : {}, { status: res.ok ? 502 : res.status })
  }
  const response = NextResponse.json({ session: data.session, landing: data.landing ?? '/' })
  setCookie(response, request, data.token)
  return response
}

export async function GET(request: NextRequest) {
  const token = (await cookies()).get(IMPERSONATION_COOKIE)?.value
  if (!token) return NextResponse.json({ active: false })
  let res: Response | null = null
  try {
    res = await fetch(`${BACKEND_URL}/api/v1/auth/impersonation/status`, {
      headers: forwardHeaders(request, token),
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    res = null
  }
  if (!res || res.status >= 500) {
    // Unknown, not ended: the caller keeps the session and asks again.
    return NextResponse.json({ active: true, unknown: true })
  }
  if (!res.ok) {
    const response = NextResponse.json({ active: false, ended: true })
    clearCookie(response, request)
    return response
  }
  return NextResponse.json({ active: true, session: await readJson(res) })
}

export async function DELETE(request: NextRequest) {
  if (isCrossSite(request)) {
    return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 })
  }
  const token = (await cookies()).get(IMPERSONATION_COOKIE)?.value
  let returnUrl: string | null = null
  if (token) {
    try {
      const res = await fetch(`${BACKEND_URL}/api/v1/auth/impersonation/end`, {
        method: 'POST',
        headers: forwardHeaders(request, token),
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) returnUrl = (await readJson(res))?.return_url ?? null
    } catch {
      /* The cookie goes regardless; the record expires on its own. */
    }
  }
  const response = NextResponse.json({ ended: true, return_url: returnUrl })
  clearCookie(response, request)
  return response
}
