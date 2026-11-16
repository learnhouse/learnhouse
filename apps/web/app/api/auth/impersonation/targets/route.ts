import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { IMPERSONATION_COOKIE } from '@services/auth/cookies'
import { BACKEND_URL, forwardHeaders, readJson } from '../_lib'

// The badge's member search: members and roles of the impersonated org.
export async function GET(request: NextRequest) {
  const token = (await cookies()).get(IMPERSONATION_COOKIE)?.value
  if (!token) return NextResponse.json({ detail: 'Not impersonating' }, { status: 404 })
  const q = request.nextUrl.searchParams.get('q') || ''
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/auth/impersonation/targets?q=${encodeURIComponent(q.slice(0, 100))}`, {
      headers: forwardHeaders(request, token),
      cache: 'no-store',
    })
    return NextResponse.json(await readJson(res), { status: res.status })
  } catch {
    return NextResponse.json({ detail: 'The API could not be reached' }, { status: 502 })
  }
}
