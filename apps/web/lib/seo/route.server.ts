import { NextRequest, NextResponse } from 'next/server'
import {
  getCommunityThumbnailMediaDirectory,
  getCourseThumbnailMediaDirectory,
  getEpisodeAudioMediaDirectory,
  getEpisodeThumbnailMediaDirectory,
  getOrgLogoMediaDirectory,
  getPathThumbnailMediaDirectory,
  getPodcastThumbnailMediaDirectory,
} from '@services/media/media'
import type { FeedMedia } from './feedMapping'

/**
 * Shared bits of the per-org public route handlers (feeds, llms.txt,
 * Markdown, manifest, IndexNow key). The proxy resolves the tenant and passes
 * its slug in `X-Seo-Orgslug` (any client-sent copy is stripped there), so a
 * handler never serves one org's content under another org's host.
 */
export const SEO_ORGSLUG_HEADER = 'X-Seo-Orgslug'

export function orgslugFrom(request: NextRequest): string | null {
  return request.headers.get(SEO_ORGSLUG_HEADER)
}

/**
 * The handler's parameters: on a proxy rewrite, `nextUrl` keeps the public
 * URL's query, so the proxy passes the internal one in `X-Seo-Params`.
 */
export function routeParams(request: NextRequest): URLSearchParams {
  const fromProxy = request.headers.get('X-Seo-Params')
  return fromProxy !== null ? new URLSearchParams(fromProxy) : request.nextUrl.searchParams
}

/** Absolute origin of the request (the tenant host), no trailing slash. */
export function requestBase(request: NextRequest): string {
  const host = request.headers.get('host') || 'localhost'
  const proto =
    request.headers.get('x-forwarded-proto') || (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https')
  return `${proto}://${host}`
}

/** Public, shared-cacheable response: the same for every visitor of a host. */
export function publicResponse(body: string, contentType: string, opts: { maxAge?: number; noindex?: boolean; status?: number } = {}) {
  const maxAge = opts.maxAge ?? 900
  return new NextResponse(body, {
    status: opts.status ?? 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': `public, max-age=${Math.min(maxAge, 300)}, s-maxage=${maxAge}, stale-while-revalidate=86400`,
      Vary: `Host, X-Forwarded-Proto, ${SEO_ORGSLUG_HEADER}`,
      'Access-Control-Allow-Origin': '*',
      ...(opts.noindex ? { 'X-Robots-Tag': 'noindex' } : {}),
    },
  })
}

export function notFoundText(message = 'Not found') {
  return new NextResponse(message, {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=60, s-maxage=300', 'X-Robots-Tag': 'noindex' },
  })
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export const feedMedia: FeedMedia = {
  course: getCourseThumbnailMediaDirectory,
  path: getPathThumbnailMediaDirectory,
  podcast: getPodcastThumbnailMediaDirectory,
  community: getCommunityThumbnailMediaDirectory,
  episodeImage: getEpisodeThumbnailMediaDirectory,
  episodeAudio: getEpisodeAudioMediaDirectory,
  orgLogo: getOrgLogoMediaDirectory,
}
