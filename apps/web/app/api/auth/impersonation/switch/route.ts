import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { IMPERSONATION_COOKIE } from '@services/auth/cookies'
import { BACKEND_URL, forwardHeaders, isCrossSite, readJson, setCookie } from '../_lib'

// From the badge: act as another member, preview a role, flip read-only or
// messaging. The API ends the current impersonation and issues the next
// token, which replaces the cookie.
export async function POST(request: NextRequest) {
  if (isCrossSite(request)) {
    return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 })
  }
  const token = (await cookies()).get(IMPERSONATION_COOKIE)?.value
  if (!token) return NextResponse.json({ detail: 'Not impersonating' }, { status: 404 })
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ detail: 'Invalid request' }, { status: 400 })
  }
  let res: Response
  try {
    res = await fetch(`${BACKEND_URL}/api/v1/auth/impersonation/switch`, {
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
  const response = NextResponse.json({ session: data.session })
  setCookie(response, request, data.token)
  return response
}
