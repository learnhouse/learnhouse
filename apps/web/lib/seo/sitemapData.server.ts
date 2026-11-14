import { cache } from 'react'
import { getServerAPIUrl } from '@services/config/config'
import type { SitemapData } from './sitemap'

/**
 * The org's indexable public content (public, published, not noindex), one
 * API call. Shared by the sitemap route and the list pages' ItemList data.
 */
export const fetchSitemapData = cache(async (orgslug: string): Promise<SitemapData | null> => {
  try {
    const res = await fetch(`${getServerAPIUrl()}seo/sitemap/${encodeURIComponent(orgslug)}`, {
      next: { revalidate: 300, tags: ['seo-sitemap', 'courses', 'podcasts', 'communities', 'folders'] },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    return (await res.json()) as SitemapData
  } catch {
    return null
  }
})
