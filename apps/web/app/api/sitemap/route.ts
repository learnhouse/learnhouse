import { NextRequest, NextResponse } from 'next/server'
import {
  getCommunityThumbnailMediaDirectory,
  getCourseThumbnailMediaDirectory,
  getFolderThumbnailMediaDirectory,
  getPathThumbnailMediaDirectory,
  getPodcastThumbnailMediaDirectory,
} from '@services/media/media'
import { getServerAPIUrl } from '@services/config/config'
import {
  SITEMAP_TYPES,
  buildSitemapIndex,
  buildUrlset,
  sitemapIndexEntries,
  sitemapUrls,
  type SitemapData,
  type SitemapEntry,
  type SitemapType,
} from '@/lib/seo/sitemap'

// Everything here is anonymous, so the output is public and the same for
// every visitor of a host: cache it at the edge and keep crawlers off the API.
const SITEMAP_HEADERS = {
  'Content-Type': 'application/xml; charset=utf-8',
  'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
  Vary: 'Host, X-Sitemap-Orgslug',
  'X-Robots-Tag': 'noindex',
}

function getBaseUrlFromRequest(request: NextRequest): string {
  const host = request.headers.get('host') || 'localhost'
  const proto = request.headers.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

async function fetchSitemapData(orgSlug: string): Promise<SitemapData | null> {
  try {
    const res = await fetch(`${getServerAPIUrl()}seo/sitemap/${encodeURIComponent(orgSlug)}`, {
      next: { revalidate: 300, tags: ['seo-sitemap', 'courses', 'podcasts', 'communities', 'folders'] },
      signal: AbortSignal.timeout(15000),
    })
    return res.ok ? ((await res.json()) as SitemapData) : null
  } catch {
    return null
  }
}

function imageUrl(orgUuid: string) {
  return (type: 'course' | 'path' | 'podcast' | 'community' | 'folder', e: SitemapEntry): string => {
    if (!e.image || e.image.includes('/')) return ''
    switch (type) {
      case 'course':
        return getCourseThumbnailMediaDirectory(orgUuid, e.uuid, e.image)
      case 'path':
        return getPathThumbnailMediaDirectory(orgUuid, e.uuid, e.image)
      case 'podcast':
        return getPodcastThumbnailMediaDirectory(orgUuid, e.uuid, e.image)
      case 'community':
        return getCommunityThumbnailMediaDirectory(orgUuid, e.uuid, e.image)
      case 'folder':
        return getFolderThumbnailMediaDirectory(orgUuid, e.uuid, e.image)
    }
  }
}

export async function GET(request: NextRequest) {
  const orgSlug = request.headers.get('X-Sitemap-Orgslug')
  if (!orgSlug) {
    return NextResponse.json({ error: 'Missing X-Sitemap-Orgslug header' }, { status: 400 })
  }
  const sitemapType = request.nextUrl.searchParams.get('type')
  if (sitemapType && !(SITEMAP_TYPES as readonly string[]).includes(sitemapType)) {
    return NextResponse.json({ error: 'Invalid sitemap type' }, { status: 404 })
  }

  const base = getBaseUrlFromRequest(request)
  const data = await fetchSitemapData(orgSlug)
  if (!data) {
    // Don't cache an outage as an empty sitemap.
    return new NextResponse('Sitemap temporarily unavailable', { status: 503, headers: { 'Retry-After': '300' } })
  }

  // The index lists only non-empty child sitemaps, with their latest lastmod.
  if (!sitemapType) {
    return new NextResponse(buildSitemapIndex(sitemapIndexEntries(data, base)), { headers: SITEMAP_HEADERS })
  }

  const urls = sitemapUrls(sitemapType as SitemapType, data, { base, imageUrl: imageUrl(data.org.org_uuid) })
  return new NextResponse(buildUrlset(urls), { headers: SITEMAP_HEADERS })
}
