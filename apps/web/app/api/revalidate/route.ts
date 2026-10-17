import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { ACCESS_TOKEN_COOKIE } from '@services/auth/cookies'
import { getServerAPIUrl } from '@services/config/config'

export const dynamic = 'force-dynamic'

// The cache tags the dashboard busts after an edit. Anything else is refused
// so this route can't be used to flush arbitrary caches.
const REVALIDATABLE_TAGS = new Set([
  'activities',
  'communities',
  'courses',
  'folders',
  'organizations',
  'podcasts',
])

async function hasValidSession(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value
  if (!token) return false
  try {
    const res = await fetch(`${getServerAPIUrl()}users/session`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function GET(request: NextRequest) {
  // Called from the signed-in dashboard (same origin, cookies attached) right
  // after an edit, so the access token is fresh. The session is checked against
  // the backend: a cookie that merely exists (forged or expired) must not let
  // anyone flush shared caches on demand.
  if (!(await hasValidSession(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tag = request.nextUrl.searchParams.get('tag')

  if (!tag || !REVALIDATABLE_TAGS.has(tag)) {
    return NextResponse.json({ error: 'Unknown tag' }, { status: 400 })
  }

  revalidateTag(tag, {})

  // When organizations change, also bust course/folder caches since they
  // embed org data (config, features, etc.)
  if (tag === 'organizations') {
    revalidateTag('courses', {})
    revalidateTag('folders', {})
  }

  return NextResponse.json({ revalidated: true, now: Date.now(), tag })
}
