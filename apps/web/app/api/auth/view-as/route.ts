import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ACCESS_TOKEN_COOKIE, IMPERSONATION_COOKIE } from '@services/auth/cookies'
import { BACKEND_URL, forwardHeaders, isCrossSite, readJson, setCookie } from '../impersonation/_lib'

// Admin "view as": an org admin sees the platform as one of their learners,
// read-only. The API checks every rule (admin of the org, learner target,
// same org); this only carries the admin's own session there and puts the
// returned token in the httpOnly LH_imp cookie, next to (never instead of) the
// admin's own session, so ending it is just dropping that cookie.
export async function POST(request: NextRequest) {
  if (isCrossSite(request)) {
    return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 })
  }
  const jar = await cookies()
  if (jar.get(IMPERSONATION_COOKIE)?.value) {
    return NextResponse.json({ detail: 'End the current view first.' }, { status: 409 })
  }
  const token = jar.get(ACCESS_TOKEN_COOKIE)?.value
  if (!token || token.toLowerCase().startsWith('lh_')) {
    return NextResponse.json({ detail: 'Sign in first' }, { status: 401 })
  }
  let body: { org_id?: unknown; user_id?: unknown; return_url?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ detail: 'Invalid request' }, { status: 400 })
  }
  const orgId = Number(body?.org_id)
  const userId = Number(body?.user_id)
  if (!Number.isInteger(orgId) || orgId <= 0 || !Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ detail: 'Invalid request' }, { status: 400 })
  }
  const returnUrl = typeof body?.return_url === 'string' ? body.return_url.slice(0, 500) : null
  let res: Response
  try {
    res = await fetch(`${BACKEND_URL}/api/v1/orgs/${orgId}/members/${userId}/view-as`, {
      method: 'POST',
      headers: { ...forwardHeaders(request, token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ return_url: returnUrl }),
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
