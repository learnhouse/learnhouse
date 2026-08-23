import { NextRequest, NextResponse } from 'next/server'
import { getServerAPIUrl } from '@services/config/config'

/**
 * Whether `slug` is the shared demo organization, according to the API.
 *
 * Never throws: robots.txt must still be served if the API is unreachable, and
 * the safe fallback there is the ordinary policy every other org gets.
 */
async function isDemoSlug(slug: string): Promise<boolean> {
  try {
    const res = await fetch(`${getServerAPIUrl()}demo/status`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2000),
    })
    if (!res.ok) return false
    const status = await res.json()
    return status?.enabled === true && status?.slug === slug
  } catch {
    return false
  }
}

function getBaseUrlFromRequest(request: NextRequest): string {
  const host = request.headers.get('host') || 'localhost'
  const proto = request.headers.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}/`
}

export async function GET(request: NextRequest) {
  const orgSlug = request.headers.get('X-Robots-Orgslug')

  if (!orgSlug) {
    return NextResponse.json(
      { error: 'Missing X-Robots-Orgslug header' },
      { status: 400 }
    )
  }

  const baseUrl = getBaseUrlFromRequest(request)

  // The shared demo sits on a real public subdomain, but its content is example
  // data that is rewritten on a schedule. Indexing it would put a fictional
  // company's course catalogue into search results competing with the real
  // marketing pages, and every indexed URL would churn.
  //
  // The demo's slug and whether it is enabled are API-side configuration, so
  // this asks the API rather than reading env vars. An earlier version read
  // LEARNHOUSE_DEMO_ENABLED / _SLUG from process.env here — neither is exposed
  // to the web process, so the check silently never fired and the demo stayed
  // indexable.
  if (await isDemoSlug(orgSlug)) {
    return new NextResponse(`User-agent: *\nDisallow: /\n`, {
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  const robotsTxt = `User-agent: *
Allow: /
Disallow: /dash/
Disallow: /api/
Disallow: /auth/
Disallow: /editor/
Disallow: /admin/
Sitemap: ${baseUrl}sitemap.xml
`

  return new NextResponse(robotsTxt, {
    headers: {
      'Content-Type': 'text/plain',
    },
  })
}
