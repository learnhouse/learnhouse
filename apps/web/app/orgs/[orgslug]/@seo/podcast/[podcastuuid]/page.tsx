import { SeoScripts } from '@components/SEO/SeoScripts'
import { getPodcastMeta } from '@services/podcasts/podcasts'
import { getPodcastThumbnailMediaDirectory } from '@services/media/media'
import { getSeoContext } from '@/lib/seo/context.server'
import { resolvePublicKey } from '@/lib/seo/resolve.server'
import { breadcrumbJsonLd, podcastSeriesJsonLd } from '@/lib/seo/jsonld'
import { seoImageUrl } from '@/lib/seo/meta'

export default async function PodcastSeo({ params }: { params: Promise<{ orgslug: string; podcastuuid: string }> }) {
  const { orgslug, podcastuuid } = await params
  const [ctx, resolved] = await Promise.all([getSeoContext(orgslug), resolvePublicKey(orgslug, 'podcast', podcastuuid)])
  if (!resolved || resolved.restricted || ctx.seo.indexing_disabled) return null
  const meta = await getPodcastMeta(resolved.uuid, null).catch(() => null)
  const podcast = meta?.podcast
  if (!podcast?.public || !podcast?.published) return null
  const seo = podcast.seo || {}
  if (seo.enable_jsonld === false || seo.robots_noindex) return null
  const url = await ctx.url(`/podcast/${resolved.canonical_key}`)
  return (
    <SeoScripts
      items={[
        podcastSeriesJsonLd({
          name: podcast.name,
          url,
          description: seo.description || podcast.description,
          image:
            seoImageUrl(ctx.org?.org_uuid, seo.og_image) ||
            (podcast.thumbnail_image ? getPodcastThumbnailMediaDirectory(ctx.org?.org_uuid, podcast.podcast_uuid, podcast.thumbnail_image) : undefined),
          org: ctx.orgRef,
          authors: (podcast.authors || [])
            .map((a: any) => ({ name: [a.user?.first_name, a.user?.last_name].filter(Boolean).join(' ') || a.user?.username }))
            .filter((a: any) => a.name),
          inLanguage: seo.in_language || ctx.lang,
          feedUrl: await ctx.url(`/podcast/${resolved.bare_uuid}/feed`),
          episodes: (meta?.episodes || [])
            .filter((e) => e.published !== false)
            .map((e) => ({
              name: e.title,
              description: e.description,
              datePublished: e.creation_date,
              durationSeconds: e.duration_seconds,
              episodeNumber: e.episode_number,
            })),
        }),
        breadcrumbJsonLd([
          { name: ctx.org?.name || 'Home', url: ctx.base },
          { name: 'Podcasts', url: await ctx.url('/podcasts') },
          { name: podcast.name, url },
        ]),
      ]}
    />
  )
}
