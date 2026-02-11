import { getUriWithOrg } from '@services/config/config'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const orgSlug = request.headers.get('X-Robots-Orgslug')

  if (!orgSlug) {
    return NextResponse.json(
      { error: 'Missing X-Robots-Orgslug header' },
      { status: 400 }
    )
  }

  const baseUrl = getUriWithOrg(orgSlug, '/')

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
