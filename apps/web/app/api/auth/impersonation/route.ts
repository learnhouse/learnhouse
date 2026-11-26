import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ACCESS_TOKEN_COOKIE, IMPERSONATION_COOKIE } from '@services/auth/cookies'
import { checkImpersonation, jwtPurpose } from '@/lib/auth/impersonationToken'
import { endReasonOf } from '@/lib/auth/impersonation'
import { noStore } from '@/lib/auth/noStore'
import { BACKEND_URL, clearCookie, forwardHeaders, isCrossSite, readJson, setCookie } from './_lib'

// Impersonation, browser side.
//
//   POST   start: the console (or an org page a staff member opened) asks the
//          API with the backoffice staff member's own session; the returned token goes into
//          the httpOnly LH_imp cookie. The backoffice staff member's own LH_access /
//          LH_refresh stay untouched, so ending is just dropping LH_imp.
//   GET    status of the impersonation this browser holds (badge, other tabs),
//          as the API sees it (it ends the session when its opener signs out).
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
  let bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  // An impersonation token acts as the member, never as staff: fall back to
  // the staff member's own session cookie instead.
  if (bearer && jwtPurpose(bearer) === 'impersonation') bearer = ''
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
    res = await fetch(`${BACKEND_URL}/api/v1/ee/backoffice/impersonations`, {
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
  return noStore(await impersonationStatus(request))
}

async function impersonationStatus(request: NextRequest): Promise<NextResponse> {
  const jar = await cookies()
  const token = jar.get(IMPERSONATION_COOKIE)?.value
  if (!token) return NextResponse.json({ active: false })
  const check = await checkImpersonation(() =>
    fetch(`${BACKEND_URL}/api/v1/auth/impersonation/status`, {
      headers: forwardHeaders(request, token),
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    }),
  )
  if (check.state === 'unknown') {
    // Unknown, not ended (down, busy, rate limited): the caller keeps the
    // session and asks again.
    return NextResponse.json({ active: true, unknown: true })
  }
  if (check.state === 'ended') {
    // Over: say why, so the badge can.
    const response = NextResponse.json({ active: false, ended: true, reason: endReasonOf(check.body) })
    clearCookie(response, request)
    return response
  }
  return NextResponse.json({ active: true, session: check.session })
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
