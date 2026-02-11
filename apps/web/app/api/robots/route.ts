import { NextRequest, NextResponse } from 'next/server'

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
