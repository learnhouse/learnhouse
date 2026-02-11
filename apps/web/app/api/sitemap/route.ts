import { getUriWithOrg } from '@services/config/config'
import { getOrgCourses, getCourseMetadata } from '@services/courses/courses'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getOrgCollections } from '@services/courses/collections'
import { getOrgPodcasts } from '@services/podcasts/podcasts'
import { getCommunities } from '@services/communities/communities'
import { getOrgDocSpaces } from '@services/docs/docspaces'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const orgSlug = request.headers.get('X-Sitemap-Orgslug')

  if (!orgSlug) {
    return NextResponse.json(
      { error: 'Missing X-Sitemap-Orgslug header' },
      { status: 400 }
    )
  }

  const orgInfo = await getOrganizationContextInfo(orgSlug, null)

  const host = request.headers.get('host')
  if (!host) {
    return NextResponse.json(
      { error: 'Missing host header' },
      { status: 400 }
    )
  }

  const baseUrl = getUriWithOrg(orgSlug, '/')

  // Fetch all content types in parallel, each wrapped in try/catch
  const [courses, collections, podcasts, communities, docspaces] =
    await Promise.all([
      getOrgCourses(orgSlug, null).catch(() => []),
      getOrgCollections(orgInfo.id).catch(() => []),
      getOrgPodcasts(orgSlug, null).catch(() => []),
      getCommunities(orgInfo.id, 1, 1000, null).catch(() => []),
      getOrgDocSpaces(orgSlug, null).catch(() => []),
    ])

  const sitemapUrls: SitemapUrl[] = [
    { loc: baseUrl, priority: 1.0, changefreq: 'daily' },
    { loc: `${baseUrl}courses`, priority: 0.9, changefreq: 'weekly' },
    { loc: `${baseUrl}collections`, priority: 0.9, changefreq: 'weekly' },
    { loc: `${baseUrl}podcasts`, priority: 0.9, changefreq: 'weekly' },
    { loc: `${baseUrl}communities`, priority: 0.9, changefreq: 'weekly' },
    { loc: `${baseUrl}docs`, priority: 0.9, changefreq: 'weekly' },
  ]

  // Courses
  for (const course of courses) {
    sitemapUrls.push({
      loc: `${baseUrl}course/${course.course_uuid.replace('course_', '')}`,
      priority: 0.7,
      changefreq: 'weekly',
      lastmod: course.update_date,
    })
  }

  // Course activities — fetch metadata per course to get chapters/activities
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
              const activityId = (activity.activity_uuid || '').replace(
                'activity_',
                ''
              )
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

  // Collections
  for (const collection of collections) {
    sitemapUrls.push({
      loc: `${baseUrl}collections/${collection.collection_uuid.replace('collection_', '')}`,
      priority: 0.6,
      changefreq: 'weekly',
      lastmod: collection.update_date,
    })
  }

  // Podcasts
  for (const podcast of podcasts) {
    sitemapUrls.push({
      loc: `${baseUrl}podcast/${podcast.podcast_uuid.replace('podcast_', '')}`,
      priority: 0.7,
      changefreq: 'weekly',
      lastmod: podcast.update_date,
    })
  }

  // Communities
  for (const community of communities) {
    sitemapUrls.push({
      loc: `${baseUrl}community/${community.community_uuid.replace('community_', '')}`,
      priority: 0.6,
      changefreq: 'weekly',
      lastmod: community.update_date,
    })
  }

  // Doc spaces
  for (const space of docspaces) {
    sitemapUrls.push({
      loc: `${baseUrl}docs/${space.slug}`,
      priority: 0.7,
      changefreq: 'weekly',
      lastmod: space.update_date,
    })
  }

  const sitemap = generateSitemap(sitemapUrls)

  return new NextResponse(sitemap, {
    headers: {
      'Content-Type': 'application/xml',
    },
  })
}

interface SitemapUrl {
  loc: string
  priority: number
  changefreq: string
  lastmod?: string
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
