/**
 * Community index views (`?sort=`, `?label=`, `?page=`) for search engines:
 * which views are indexable, their canonical URLs and alternates.
 *
 * - The default order (latest) is the indexable list; `?page=N` pages carry a
 *   self-referencing canonical, and label pages (`?label=question`) are real
 *   topic pages with their own canonical.
 * - Re-sorted views (top, hot, unanswered) show the same threads in another
 *   order: `noindex, follow`, canonical to the default order, so crawlers
 *   follow their links without indexing duplicates.
 */
import type { Metadata } from 'next'
import type { SeoContext } from './context.server'
import { feedsEnabled, llmsEnabled } from './meta'

export type FeedSortKey = 'latest' | 'top' | 'hot' | 'unanswered'
const SORTS: FeedSortKey[] = ['latest', 'top', 'hot', 'unanswered']
export const COMMUNITY_LABELS = ['general', 'question', 'idea', 'announcement', 'showcase'] as const
const API_SORT = { latest: 'recent', top: 'upvotes', hot: 'hot', unanswered: 'recent' } as const

export type CommunityFeedView = {
  sort: FeedSortKey
  apiSort: (typeof API_SORT)[FeedSortKey]
  label: string | null
  page: number
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export function communityFeedView(searchParams?: Record<string, string | string[] | undefined> | null): CommunityFeedView {
  const rawSort = first(searchParams?.sort)
  const sort = SORTS.includes(rawSort as FeedSortKey) ? (rawSort as FeedSortKey) : 'latest'
  const rawLabel = first(searchParams?.label)
  const label = rawLabel && (COMMUNITY_LABELS as readonly string[]).includes(rawLabel) ? rawLabel : null
  const page = Math.min(500, Math.max(1, parseInt(first(searchParams?.page) || '1', 10) || 1))
  return { sort, apiSort: API_SORT[sort], label, page }
}

/** `?label=&page=` of the canonical URL of a view (sort is never canonical). */
export function canonicalQuery(view: Pick<CommunityFeedView, 'label' | 'page'>): string {
  const q = new URLSearchParams()
  if (view.label) q.set('label', view.label)
  if (view.page > 1) q.set('page', String(view.page))
  const s = q.toString()
  return s ? `?${s}` : ''
}

const LABEL_TITLES: Record<string, string> = { general: 'General', question: 'Q&A', idea: 'Ideas', announcement: 'Announcements', showcase: 'Show and Tell' }

export async function communityViewMetadata(
  base: Metadata,
  opts: { ctx: SeoContext; key: string; view: CommunityFeedView; indexable: boolean; name: string },
): Promise<Metadata> {
  const { ctx, key, view } = opts
  const path = `/community/${key}`
  const canonical = `${await ctx.url(path)}${canonicalQuery(view)}`
  const resorted = view.sort !== 'latest'
  const types: Record<string, string> = {}
  if (opts.indexable && feedsEnabled(ctx.seo)) {
    types['application/rss+xml'] = await ctx.url(`${path}/feed.xml`)
    types['application/atom+xml'] = await ctx.url(`${path}/feed.atom`)
    types['application/feed+json'] = await ctx.url(`${path}/feed.json`)
  }
  if (opts.indexable && llmsEnabled(ctx.seo) && !view.label && view.page === 1) types['text/markdown'] = await ctx.url(`${path}.md`)
  const suffix = [view.label ? LABEL_TITLES[view.label] : '', view.page > 1 ? `page ${view.page}` : ''].filter(Boolean).join(', ')
  const robots = base.robots as any
  const index = !!robots?.index && !resorted
  const baseCanonical = (base.alternates as any)?.canonical
  // A canonical set on the community itself (SEO settings) always wins.
  const ownCanonical = baseCanonical && baseCanonical !== (await ctx.url(path)) ? baseCanonical : null
  return {
    ...base,
    ...(suffix && typeof base.title === 'string' ? { title: base.title.replace(opts.name, `${opts.name} (${suffix})`) } : {}),
    robots: { ...robots, index, googleBot: { ...(robots?.googleBot || {}), index } },
    alternates: { ...(base.alternates || {}), canonical: ownCanonical || (resorted ? `${await ctx.url(path)}${canonicalQuery({ label: view.label, page: 1 })}` : canonical), ...(Object.keys(types).length ? { types } : {}) },
    openGraph: { ...(base.openGraph || {}), url: ownCanonical || canonical },
  }
}
