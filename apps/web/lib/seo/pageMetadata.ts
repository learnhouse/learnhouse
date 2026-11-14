import type { Metadata } from 'next'
import { buildPageTitle } from './utils'
import { clipDescription, keywordList, ogLocale, robotsMetadata, seoImageUrl, type ResourceSeo } from './meta'
import type { SeoContext } from './context.server'
import { toIsoDate } from './jsonld'
import { PAGE_CARDS } from './ogCard'

/**
 * Metadata for a resource page (course, path, podcast, ...), applying the
 * resource's SEO settings over defaults derived from the resource itself.
 * Image priority: custom social image → thumbnail → generated OG image →
 * org default.
 */
export function buildResourceMetadata(opts: {
  ctx: SeoContext
  name: string
  description?: string | null
  canonical: string
  seo?: ResourceSeo | null
  thumbnail?: string | null
  /** `/og/...` URL of the generated card, used when there's no image. */
  generatedImage?: string
  ogType?: 'website' | 'article' | 'profile' | 'music.playlist' | 'video.other'
  indexable?: boolean
  keywords?: string | string[] | null
  publishedTime?: string | null
  modifiedTime?: string | null
  tags?: string[]
  /** Language the page is served in (og:locale); defaults to the SEO language / org language. */
  locale?: string | null
  /** Other language versions (og:locale:alternate), as content locales. */
  alternateLocales?: string[]
  /** hreflang → absolute URL, incl. `x-default` (multilingual courses). */
  languages?: Record<string, string>
}): Metadata {
  const { ctx } = opts
  const seo = opts.seo || {}
  const title = seo.title?.trim() || buildPageTitle(opts.name, ctx.org?.name || '', ctx.seo)
  const description = clipDescription(seo.description || opts.description || ctx.seo.default_meta_description || '')
  const image =
    seoImageUrl(ctx.org?.org_uuid, seo.og_image) || opts.thumbnail || opts.generatedImage || ctx.defaultImage
  const imageAlt = seo.image_alt || opts.name
  const ogTitle = seo.og_title || seo.title || title
  const ogDescription = clipDescription(seo.og_description || seo.description || description, 200)
  const ogType = (seo.og_type as any) || opts.ogType || 'website'
  const isArticle = ogType === 'article'
  const canonical = seo.canonical_url || opts.canonical
  return {
    title,
    description,
    keywords: keywordList(seo.keywords || opts.keywords),
    robots: robotsMetadata({ orgSeo: ctx.seo, seo, indexable: opts.indexable }),
    alternates: opts.languages ? { canonical, languages: opts.languages } : { canonical },
    openGraph: {
      title: ogTitle,
      description: ogDescription,
      url: canonical,
      siteName: ctx.org?.name,
      locale: ogLocale(opts.locale || seo.in_language || ctx.lang),
      ...(opts.alternateLocales?.length ? { alternateLocale: opts.alternateLocales.map(ogLocale) } : {}),
      type: ogType,
      ...(image ? { images: [{ url: image, alt: imageAlt, ...(image === opts.generatedImage ? { width: 1200, height: 630 } : {}) }] } : {}),
      ...(isArticle
        ? {
            publishedTime: toIsoDate(opts.publishedTime),
            modifiedTime: toIsoDate(opts.modifiedTime),
            ...(opts.tags?.length ? { tags: opts.tags } : {}),
          }
        : {}),
    } as any,
    twitter: {
      card: (seo.twitter_card as 'summary' | 'summary_large_image') || 'summary_large_image',
      title: seo.twitter_title || ogTitle,
      description: clipDescription(seo.twitter_description || ogDescription, 200),
      ...(image ? { images: [{ url: image, alt: imageAlt }] } : {}),
      ...(ctx.seo.twitter_handle ? { site: ctx.seo.twitter_handle } : {}),
    },
  }
}

/** Metadata for a page that must not be indexed (no access, missing data). */
export function noindexMetadata(title: string): Metadata {
  return { title, robots: { index: false, follow: false } }
}

/** Metadata for an org-level catalog page (/courses, /paths, ...). */
export async function buildListMetadata(opts: {
  ctx: SeoContext
  name: string
  path: string
  description?: string | null
  keywords?: string | string[]
  noindex?: boolean
  /** A page's own social image (builder pages): an absolute URL or a site path. */
  image?: string | null
}): Promise<Metadata> {
  const { ctx } = opts
  const title = buildPageTitle(opts.name, ctx.org?.name || '', ctx.seo)
  const description = clipDescription(opts.description || ctx.org?.description || ctx.seo.default_meta_description || '')
  const canonical = await ctx.url(opts.path)
  // Org default image, else a generated card in the org's colors.
  const pageKey = opts.path === '/' ? 'home' : opts.path.replace(/^\//, '')
  const own = opts.image && /^(https?:\/\/|\/(?!\/))/i.test(opts.image) ? (opts.image.startsWith('/') ? await ctx.url(opts.image) : opts.image) : undefined
  const image = own || ctx.defaultImage || (PAGE_CARDS[pageKey] ? await ctx.url(`/og/page/${pageKey}`) : undefined)
  return {
    title,
    description,
    keywords: keywordList(opts.keywords),
    robots: robotsMetadata({ orgSeo: ctx.seo, indexable: !opts.noindex }),
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: ctx.org?.name,
      locale: ogLocale(ctx.lang),
      type: 'website',
      ...(image ? { images: [{ url: image, alt: ctx.org?.name }] } : {}),
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title,
      description,
      ...(image ? { images: [image] } : {}),
      ...(ctx.seo.twitter_handle ? { site: ctx.seo.twitter_handle } : {}),
    },
  }
}
