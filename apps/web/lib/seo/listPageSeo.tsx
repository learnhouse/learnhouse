import { SeoScripts } from '@components/SEO/SeoScripts'
import { getSeoContext } from './context.server'
import { fetchSitemapData } from './sitemapData.server'
import { breadcrumbJsonLd, itemListJsonLd } from './jsonld'
import type { SitemapData } from './sitemap'

type ListKind = 'courses' | 'paths' | 'podcasts' | 'communities' | 'folders'
const SEGMENT: Record<ListKind, string> = {
  courses: '/course/',
  paths: '/path/',
  podcasts: '/podcast/',
  communities: '/community/',
  folders: '/library/folder/',
}

/**
 * Structured data of a catalog page: breadcrumbs and an ItemList of the
 * indexable items it shows (Google's summary-page carousel format).
 */
export async function ListPageSeo({ orgslug, title, path, kind }: { orgslug: string; title: string; path: string; kind?: ListKind }) {
  const ctx = await getSeoContext(orgslug)
  if (ctx.seo.indexing_disabled) return null
  const pageUrl = await ctx.url(path)
  let list = null
  if (kind) {
    const data: SitemapData | null = await fetchSitemapData(orgslug)
    const items = (data?.[kind] || []).slice(0, 100)
    if (items.length) {
      list = itemListJsonLd(
        title,
        await Promise.all(items.map(async (i) => ({ url: await ctx.url(`${SEGMENT[kind]}${encodeURIComponent(i.key)}`), name: i.name }))),
      )
    }
  }
  return (
    <SeoScripts
      items={[
        breadcrumbJsonLd([
          { name: ctx.org?.name || 'Home', url: ctx.base },
          { name: title, url: pageUrl },
        ]),
        list,
      ]}
    />
  )
}
