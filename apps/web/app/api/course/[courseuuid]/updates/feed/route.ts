import { NextRequest, NextResponse } from 'next/server'
import { getCourseMetadata } from '@services/courses/courses'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'

/**
 * RSS feed of a course's updates. Anonymous: the API only returns updates of
 * courses the visitor could read anyway, so private courses yield no feed.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ courseuuid: string }> }
) {
  const { courseuuid } = await params
  const orgSlug = request.headers.get('X-Feed-Orgslug')

  if (!orgSlug) {
    return NextResponse.json({ error: 'Missing org context' }, { status: 400 })
  }

  try {
    const org = await getOrganizationContextInfo(orgSlug, null).catch(() => null)
    const course = await getCourseMetadata(courseuuid, null, null, { slim: true }).catch(() => null)

    // Only serve a course under its own org's host.
    if (!course?.course_uuid || !org?.org_uuid || (org.id != null && course.org_id != null && course.org_id !== org.id)) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 })
    }

    const updatesRes = await fetch(`${getAPIUrl()}courses/${course.course_uuid}/updates`, {
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    })
    if (!updatesRes.ok) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 })
    }
    const updates: any[] = await updatesRes.json()

    // RSS requires absolute URLs. The host the feed was fetched on is the
    // right one (org subdomain or custom domain); the configured org URL is
    // only a fallback for internal hosts. `getUriWithOrg` is relative in
    // single tenancy, so it can't be used alone.
    const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host')
    const isInternalHost = !forwardedHost || INTERNAL_HOST.test(forwardedHost)
    const forwardedProto = request.headers.get('x-forwarded-proto')
      || (isInternalHost ? 'http' : 'https')
    const origin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : request.nextUrl.origin
    const orgBase = getUriWithOrg(orgSlug, '/')
    const baseUrl = isInternalHost && /^https?:\/\//i.test(orgBase) ? orgBase : `${origin}/`
    const courseUrl = `${baseUrl}course/${courseuuid}`
    const feedUrl = `${baseUrl}course/${courseuuid}/updates/feed`

    const imageUrl = course.thumbnail_image
      ? getCourseThumbnailMediaDirectory(org.org_uuid, course.course_uuid, course.thumbnail_image)
      : ''

    const items = (Array.isArray(updates) ? updates : [])
      .map((update: any) => {
        const pubDate = update.creation_date ? new Date(update.creation_date).toUTCString() : ''
        return `    <item>
      <title>${escapeXml(update.title || '')}</title>
      <description>${escapeXml(update.content || '')}</description>
      <link>${escapeXml(courseUrl)}</link>
      <guid isPermaLink="false">${escapeXml(update.courseupdate_uuid || String(update.id))}</guid>
      ${pubDate ? `<pubDate>${pubDate}</pubDate>` : ''}
    </item>`
      })
      .join('\n')

    const title = `${course.name} - Updates`
    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(courseUrl)}</link>
    <description>${escapeXml(course.description || course.about || title)}</description>
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
    ${imageUrl ? `<image>
      <url>${escapeXml(imageUrl)}</url>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(courseUrl)}</link>
    </image>` : ''}
${items}
  </channel>
</rss>`

    return new NextResponse(rss, {
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=900, s-maxage=900',
        // Absolute URLs come from the request host in single tenancy; keep
        // cached variants separated by host so one tenant's feed is never
        // served under another's name.
        'Vary': 'Host, X-Forwarded-Host, X-Forwarded-Proto',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to generate feed' }, { status: 500 })
  }
}

const INTERNAL_HOST = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/i

function escapeXml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
