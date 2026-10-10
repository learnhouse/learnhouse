import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '@services/auth/cookies'

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

export async function GET(request: NextRequest) {
  // Called from the signed-in dashboard (same origin, cookies attached).
  // Anonymous callers have nothing to revalidate.
  if (
    !request.cookies.get(ACCESS_TOKEN_COOKIE)?.value &&
    !request.cookies.get(REFRESH_TOKEN_COOKIE)?.value
  ) {
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
