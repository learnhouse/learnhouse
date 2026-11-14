/**
 * XML sitemap builders (sitemaps.org protocol + Google image extension).
 * Pure: the route handler fetches the data and passes absolute URLs in.
 */
import { toIsoDate } from './jsonld'
import { courseLocaleList, sitemapLanguageLinks, withLangParam } from './alternates'

export type SitemapImage = { loc: string; title?: string }
export type SitemapUrl = {
  loc: string
  lastmod?: string | null
  changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never'
  priority?: number
  images?: SitemapImage[]
  /** Language versions (`<xhtml:link rel="alternate" hreflang>`), incl. this URL and x-default. */
  alternates?: { hreflang: string; href: string }[]
}

export const SITEMAP_TYPES = ['pages', 'courses', 'activities', 'paths', 'podcasts', 'communities', 'discussions', 'folders'] as const
export type SitemapType = (typeof SITEMAP_TYPES)[number]

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** W3C datetime for `<lastmod>`, or undefined when the date can't be parsed. */
export function sitemapDate(value?: string | null): string | undefined {
  const iso = toIsoDate(value)
  return iso ? iso.replace(/\.\d{3}Z$/, 'Z') : undefined
}

export function buildUrlset(urls: SitemapUrl[]): string {
  const hasImages = urls.some((u) => u.images?.length)
  const entries = urls
    .map((u) => {
      const parts = [`<loc>${xmlEscape(u.loc)}</loc>`]
      const lastmod = sitemapDate(u.lastmod)
      if (lastmod) parts.push(`<lastmod>${lastmod}</lastmod>`)
      if (u.changefreq) parts.push(`<changefreq>${u.changefreq}</changefreq>`)
      if (u.priority != null) parts.push(`<priority>${Math.min(1, Math.max(0, u.priority)).toFixed(1)}</priority>`)
      for (const alt of u.alternates || []) {
        parts.push(`<xhtml:link rel="alternate" hreflang="${xmlEscape(alt.hreflang)}" href="${xmlEscape(alt.href)}"/>`)
      }
      for (const img of u.images || []) {
        if (!img.loc) continue
        parts.push(
          `<image:image><image:loc>${xmlEscape(img.loc)}</image:loc>${img.title ? `<image:title>${xmlEscape(img.title)}</image:title>` : ''}</image:image>`,
        )
      }
      return `  <url>${parts.join('')}</url>`
    })
    .join('\n')
  const hasAlternates = urls.some((u) => u.alternates?.length)
  const ns =
    (hasAlternates ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml"' : '') +
    (hasImages ? ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"' : '')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${ns}>\n${entries}\n</urlset>\n`
}

export function buildSitemapIndex(sitemaps: { loc: string; lastmod?: string | null }[]): string {
  const entries = sitemaps
    .map((s) => {
      const lastmod = sitemapDate(s.lastmod)
      return `  <sitemap><loc>${xmlEscape(s.loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</sitemap>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>\n`
}

/** Most recent of a list of API dates (for a child sitemap's index `<lastmod>`). */
export function latestDate(values: (string | null | undefined)[]): string | undefined {
  let best: string | undefined
  for (const v of values) {
    const iso = toIsoDate(v)
    if (iso && (!best || iso > best)) best = iso
  }
  return best
}

export type SitemapData = {
  org: { slug: string; org_uuid: string; name: string; indexing_disabled: boolean; noindex_communities: boolean }
  courses: SitemapEntry[]
  activities: { course_key: string; key: string; lastmod: string }[]
  paths: SitemapEntry[]
  podcasts: SitemapEntry[]
  communities: SitemapEntry[]
  discussions: { community_key: string; key: string; name: string; lastmod: string }[]
  folders: SitemapEntry[]
}
export type SitemapEntry = {
  key: string
  uuid: string
  name: string
  lastmod: string
  image: string
  /** Courses: source language and published translations (multilingual courses). */
  default_locale?: string | null
  available_locales?: string[] | null
}

export type SitemapContext = {
  /** Absolute origin with no trailing slash, e.g. `https://academy.example.com`. */
  base: string
  /** Absolute URL of a resource thumbnail, or '' when there is none. */
  imageUrl: (type: 'course' | 'path' | 'podcast' | 'community' | 'folder', entry: SitemapEntry) => string
  /** Which top-level sections the org shows (menu/features); unknown = shown. */
  sections?: Partial<Record<'courses' | 'paths' | 'podcasts' | 'communities' | 'library', boolean>>
  /** Language of courses without a `default_locale` (the org language), `en` when unknown. */
  defaultLocale?: string
}

function entryUrls(
  data: SitemapEntry[],
  type: 'course' | 'path' | 'podcast' | 'community' | 'folder',
  segment: string,
  ctx: SitemapContext,
  priority: number,
): SitemapUrl[] {
  return data.flatMap((e) => {
    const image = ctx.imageUrl(type, e)
    const loc = `${ctx.base}/${segment}/${encodeURIComponent(e.key)}`
    const url: SitemapUrl = {
      loc,
      lastmod: e.lastmod,
      priority,
      images: image ? [{ loc: image, title: e.name }] : undefined,
    }
    return languageVersions(url, e, ctx.defaultLocale)
  })
}

/**
 * A multilingual course is one `<url>` per language version (`?lang=xx` for
 * translations), each listing every version plus x-default, as Google asks.
 * Single-language entries come back unchanged.
 */
export function languageVersions(url: SitemapUrl, entry: Pick<SitemapEntry, 'default_locale' | 'available_locales'>, fallbackLocale = 'en'): SitemapUrl[] {
  const defaultLocale = entry.default_locale || fallbackLocale
  const alternates = sitemapLanguageLinks(url.loc, defaultLocale, entry.available_locales)
  if (!alternates.length) return [url]
  const [, ...translations] = courseLocaleList(defaultLocale, entry.available_locales)
  return [
    { ...url, alternates },
    ...translations.map((locale) => ({ ...url, loc: withLangParam(url.loc, locale), images: undefined, alternates })),
  ]
}

/** URLs of one child sitemap. */
export function sitemapUrls(type: SitemapType, data: SitemapData, ctx: SitemapContext): SitemapUrl[] {
  const shown = (k: keyof NonNullable<SitemapContext['sections']>) => ctx.sections?.[k] !== false
  switch (type) {
    case 'pages': {
      const urls: SitemapUrl[] = [{ loc: `${ctx.base}/`, changefreq: 'daily', priority: 1.0, lastmod: latestDate(data.courses.map((c) => c.lastmod)) }]
      if (shown('courses') && data.courses.length) urls.push({ loc: `${ctx.base}/courses`, changefreq: 'weekly', priority: 0.9, lastmod: latestDate(data.courses.map((c) => c.lastmod)) })
      if (shown('paths') && data.paths.length) urls.push({ loc: `${ctx.base}/paths`, changefreq: 'weekly', priority: 0.8, lastmod: latestDate(data.paths.map((c) => c.lastmod)) })
      if (shown('podcasts') && data.podcasts.length) urls.push({ loc: `${ctx.base}/podcasts`, changefreq: 'weekly', priority: 0.8, lastmod: latestDate(data.podcasts.map((c) => c.lastmod)) })
      if (shown('communities') && data.communities.length) urls.push({ loc: `${ctx.base}/communities`, changefreq: 'daily', priority: 0.7, lastmod: latestDate(data.discussions.map((c) => c.lastmod)) })
      if (shown('library') && data.folders.length) urls.push({ loc: `${ctx.base}/library`, changefreq: 'weekly', priority: 0.7, lastmod: latestDate(data.folders.map((c) => c.lastmod)) })
      return urls
    }
    case 'courses':
      return entryUrls(data.courses, 'course', 'course', ctx, 0.9)
    case 'activities':
      return data.activities.map((a) => ({
        loc: `${ctx.base}/course/${encodeURIComponent(a.course_key)}/activity/${encodeURIComponent(a.key)}`,
        lastmod: a.lastmod,
        priority: 0.6,
      }))
    case 'paths':
      return entryUrls(data.paths, 'path', 'path', ctx, 0.8)
    case 'podcasts':
      return entryUrls(data.podcasts, 'podcast', 'podcast', ctx, 0.7)
    case 'communities':
      return entryUrls(data.communities, 'community', 'community', ctx, 0.6)
    case 'discussions':
      return data.discussions.map((d) => ({
        loc: `${ctx.base}/community/${encodeURIComponent(d.community_key)}/discussion/${encodeURIComponent(d.key)}`,
        lastmod: d.lastmod,
        priority: 0.5,
      }))
    case 'folders':
      return entryUrls(data.folders, 'folder', 'library/folder', ctx, 0.6)
  }
}

/** Child sitemaps worth listing in the index (non-empty ones), with lastmod. */
export function sitemapIndexEntries(data: SitemapData, base: string): { loc: string; lastmod?: string }[] {
  const lists: Record<SitemapType, { lastmod: string }[]> = {
    pages: [{ lastmod: latestDate(data.courses.map((c) => c.lastmod)) || '' }],
    courses: data.courses,
    activities: data.activities,
    paths: data.paths,
    podcasts: data.podcasts,
    communities: data.communities,
    discussions: data.discussions,
    folders: data.folders,
  }
  return SITEMAP_TYPES.filter((t) => lists[t].length > 0).map((t) => ({
    loc: `${base}/sitemap.xml?type=${t}`,
    lastmod: latestDate(lists[t].map((e) => e.lastmod)),
  }))
}
