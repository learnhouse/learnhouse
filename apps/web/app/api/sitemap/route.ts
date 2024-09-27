import { getUriWithOrg } from '@services/config/config';
import { getOrgCourses } from '@services/courses/courses';
import { getOrganizationContextInfo } from '@services/organizations/orgs';
import { getOrgCollections } from '@services/courses/collections';
import { NextRequest, NextResponse } from 'next/server';


export async function GET(request: NextRequest) {
  const orgSlug = request.headers.get('X-Sitemap-Orgslug');

  if (!orgSlug) {
    return NextResponse.json({ error: 'Missing X-Sitemap-Orgslug header' }, { status: 400 });
  }

  const orgInfo = await getOrganizationContextInfo(orgSlug, null);
  const courses = await getOrgCourses(orgSlug, null);
  const collections = await getOrgCollections(orgInfo.id);

  const host = request.headers.get('host');
  if (!host) {
    return NextResponse.json({ error: 'Missing host header' }, { status: 400 });
  }

  const baseUrl = getUriWithOrg(orgSlug, '/');

  const sitemapUrls: SitemapUrl[] = [
    { loc: baseUrl, priority: 1.0, changefreq: 'daily' },
    { loc: `${baseUrl}collections`, priority: 0.9, changefreq: 'weekly' },
    { loc: `${baseUrl}courses`, priority: 0.9, changefreq: 'weekly' },
    // Courses
    ...courses.map((course: { course_uuid: string }) => ({ 
      loc: `${baseUrl}course/${course.course_uuid.replace('course_', '')}`, 
      priority: 0.7,
      changefreq: 'weekly'
    })),
    // Collections
    ...collections.map((collection: { collection_uuid: string }) => ({
      loc: `${baseUrl}collections/${collection.collection_uuid.replace('collection_', '')}`,
      priority: 0.6,
      changefreq: 'weekly'
    }))
  ];

  const sitemap = generateSitemap(baseUrl, sitemapUrls);

  return new NextResponse(sitemap, {
    headers: {
      'Content-Type': 'application/xml',
    },
  });
}

interface SitemapUrl {
    loc: string;
    priority: number;
    changefreq: string;
  }
  
  function generateSitemap(baseUrl: string, urls: SitemapUrl[]): string {
    const urlEntries = urls.map(({ loc, priority, changefreq }) => `
    <url>
      <loc>${loc}</loc>
      <priority>${priority.toFixed(1)}</priority>
      <changefreq>${changefreq}</changefreq>
    </url>`).join('');
  
    return `<?xml version="1.0" encoding="UTF-8"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${urlEntries}
  </urlset>`;
  }

