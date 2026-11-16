import { NextRequest } from 'next/server'
import { GET as feedGET } from '@/app/api/seo/feed/route'

/**
 * Legacy entry point of the podcast RSS feed. Public `/podcast/{key}/feed`
 * URLs now go straight to the shared feed handler (`/api/seo/feed`); this
 * forwards any caller still using the old internal path there, keeping the
 * proxy-set org header the only source of the org.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ podcastuuid: string }> }) {
  const { podcastuuid } = await params
  const url = new URL(request.url)
  url.pathname = '/api/seo/feed'
  url.search = `?kind=podcast&format=rss&key=${encodeURIComponent(podcastuuid)}`
  const headers = new Headers(request.headers)
  headers.delete('X-Seo-Orgslug')
  const org = request.headers.get('X-Feed-Orgslug')
  if (org) headers.set('X-Seo-Orgslug', org)
  return feedGET(new NextRequest(url, { headers }))
}
