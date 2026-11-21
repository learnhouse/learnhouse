import { NextRequest, NextResponse } from 'next/server'
import {
  getCommunityThumbnailMediaDirectory,
  getCourseThumbnailMediaDirectory,
  getFolderThumbnailMediaDirectory,
  getPathThumbnailMediaDirectory,
  getPodcastThumbnailMediaDirectory,
} from '@services/media/media'
import { getServerAPIUrl } from '@services/config/config'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { isOrgFeatureEnabled } from '@/lib/features/orgFeature'
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

/** Public, not cancelled live sessions (EE; empty without it, when the plan lacks them, or on failure). */
async function fetchPublicLiveSessions(orgSlug: string): Promise<NonNullable<SitemapData['live']>> {
  try {
    const org = await getOrganizationContextInfo(orgSlug, { revalidate: 300, tags: ['organizations'] })
    // The API 404s live sessions for orgs whose plan doesn't include them.
    if (!org?.id || !isOrgFeatureEnabled(org, 'live_sessions')) return []
    const res = await fetch(`${getServerAPIUrl()}live_sessions/org/${org.id}?scope=all&limit=100`, {
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(5000),
    })
    const sessions = res.ok ? await res.json() : []
    return (Array.isArray(sessions) ? sessions : [])
      .filter((s: any) => s?.access === 'public' && s.status !== 'cancelled' && s.live_session_uuid)
      .map((s: any) => ({ key: String(s.live_session_uuid).replace(/^livesession_/, ''), name: s.title, lastmod: s.update_date || s.creation_date || '' }))
  } catch {
    return []
  }
}

function imageUrl(orgUuid: string) {
  return (type: 'course' | 'path' | 'podcast' | 'community' | 'folder', e: SitemapEntry): string => {
    if (!e.image || e.image.includes('/')) return ''
    switch (type) {
      case 'course':
        return getCourseThumbnailMediaDirectory(orgUuid, e.uuid, e.image) ?? ''
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

  if (data.org.features?.live !== false && (!sitemapType || sitemapType === 'live' || sitemapType === 'pages')) {
    data.live = await fetchPublicLiveSessions(orgSlug)
  }

  // The index lists only non-empty child sitemaps, with their latest lastmod.
  if (!sitemapType) {
    return new NextResponse(buildSitemapIndex(sitemapIndexEntries(data, base)), { headers: SITEMAP_HEADERS })
  }

  const urls = sitemapUrls(sitemapType as SitemapType, data, { base, imageUrl: imageUrl(data.org.org_uuid) })
  return new NextResponse(buildUrlset(urls), { headers: SITEMAP_HEADERS })
}
