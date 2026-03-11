import { getOrgCourses, getCourseMetadata } from '@services/courses/courses'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getOrgCollections } from '@services/courses/collections'
import { getOrgPodcasts } from '@services/podcasts/podcasts'
import { getCommunities } from '@services/communities/communities'
import { NextRequest, NextResponse } from 'next/server'

function getBaseUrlFromRequest(request: NextRequest): string {
  const host = request.headers.get('host') || 'localhost'
  const proto = request.headers.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}/`
}

export async function GET(request: NextRequest) {
  const orgSlug = request.headers.get('X-Sitemap-Orgslug')
  const sitemapType = request.nextUrl.searchParams.get('type')

  if (!orgSlug) {
    return NextResponse.json(
      { error: 'Missing X-Sitemap-Orgslug header' },
      { status: 400 }
    )
  }

  const baseUrl = getBaseUrlFromRequest(request)

  // If no type specified, return sitemap index
  if (!sitemapType) {
    const sitemapIndex = generateSitemapIndex(baseUrl)
    return new NextResponse(sitemapIndex, {
      headers: { 'Content-Type': 'application/xml' },
    })
  }

  const orgInfo = await getOrganizationContextInfo(orgSlug, null)

  let sitemapUrls: SitemapUrl[] = []

  switch (sitemapType) {
    case 'pages': {
      sitemapUrls = [
        { loc: baseUrl, priority: 1.0, changefreq: 'daily' },
        { loc: `${baseUrl}courses`, priority: 0.9, changefreq: 'weekly' },
        { loc: `${baseUrl}collections`, priority: 0.9, changefreq: 'weekly' },
        { loc: `${baseUrl}podcasts`, priority: 0.9, changefreq: 'weekly' },
        { loc: `${baseUrl}communities`, priority: 0.9, changefreq: 'weekly' },
      ]
      break
    }
    case 'courses': {
      const courses = await getOrgCourses(orgSlug, null).catch(() => [])
      for (const course of courses) {
        sitemapUrls.push({
          loc: `${baseUrl}course/${course.course_uuid.replace('course_', '')}`,
          priority: 0.7,
          changefreq: 'weekly',
          lastmod: course.update_date,
        })
      }
      break
    }
    case 'activities': {
      const courses = await getOrgCourses(orgSlug, null).catch(() => [])
      for (const course of courses) {
        try {
          const meta = await getCourseMetadata(
            course.course_uuid.replace('course_', ''),
            null,
            null
          )
          if (meta?.chapters) {
            for (const chapter of meta.chapters) {
              if (chapter.activities) {
                for (const activity of chapter.activities) {
                  const activityId = (activity.activity_uuid || '').replace('activity_', '')
                  if (activityId) {
                    sitemapUrls.push({
                      loc: `${baseUrl}course/${course.course_uuid.replace('course_', '')}/activity/${activityId}`,
                      priority: 0.6,
                      changefreq: 'weekly',
                      lastmod: activity.update_date,
                    })
                  }
                }
              }
            }
          }
        } catch {
          // Skip activities for this course if metadata fetch fails
        }
      }
      break
    }
    case 'collections': {
      const collections = await getOrgCollections(orgInfo.id).catch(() => [])
      for (const collection of collections) {
        sitemapUrls.push({
          loc: `${baseUrl}collections/${collection.collection_uuid.replace('collection_', '')}`,
          priority: 0.6,
          changefreq: 'weekly',
          lastmod: collection.update_date,
        })
      }
      break
    }
    case 'podcasts': {
      const podcasts = await getOrgPodcasts(orgSlug, null).catch(() => [])
      for (const podcast of podcasts) {
        sitemapUrls.push({
          loc: `${baseUrl}podcast/${podcast.podcast_uuid.replace('podcast_', '')}`,
          priority: 0.7,
          changefreq: 'weekly',
          lastmod: podcast.update_date,
        })
      }
      break
    }
    case 'communities': {
      const communities = await getCommunities(orgInfo.id, 1, 1000, null).catch(() => [])
      for (const community of communities) {
        sitemapUrls.push({
          loc: `${baseUrl}community/${community.community_uuid.replace('community_', '')}`,
          priority: 0.6,
          changefreq: 'weekly',
          lastmod: community.update_date,
        })
      }
      break
    }
    default: {
      return NextResponse.json({ error: 'Invalid sitemap type' }, { status: 400 })
    }
  }

  const sitemap = generateSitemap(sitemapUrls)
  return new NextResponse(sitemap, {
    headers: { 'Content-Type': 'application/xml' },
  })
}

interface SitemapUrl {
  loc: string
  priority: number
  changefreq: string
  lastmod?: string
}

const SITEMAP_TYPES = ['pages', 'courses', 'activities', 'collections', 'podcasts', 'communities']

function generateSitemapIndex(baseUrl: string): string {
  const sitemaps = SITEMAP_TYPES.map(type => `
  <sitemap>
    <loc>${baseUrl}sitemap.xml?type=${type}</loc>
  </sitemap>`).join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemaps}
</sitemapindex>`
}

function generateSitemap(urls: SitemapUrl[]): string {
  const urlEntries = urls
    .map(({ loc, priority, changefreq, lastmod }) => {
      let entry = `
    <url>
      <loc>${loc}</loc>
      <priority>${priority.toFixed(1)}</priority>
      <changefreq>${changefreq}</changefreq>`
      if (lastmod) {
        entry += `
      <lastmod>${lastmod.split('T')[0]}</lastmod>`
      }
      entry += `
    </url>`
      return entry
    })
    .join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`
}
