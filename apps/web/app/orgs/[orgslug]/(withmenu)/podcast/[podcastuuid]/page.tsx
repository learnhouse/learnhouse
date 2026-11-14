import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPodcastMeta, PodcastMeta } from '@services/podcasts/podcasts'
import { getPodcastThumbnailMediaDirectory } from '@services/media/media'
import { getServerSession } from '@/lib/auth/server'
import { getSeoContext } from '@/lib/seo/context.server'
import { resolveForPage } from '@/lib/seo/resolve.server'
import { buildResourceMetadata, noindexMetadata } from '@/lib/seo/pageMetadata'
import PodcastClient from './podcast'

type PageParams = Promise<{
  orgslug: string
  podcastuuid: string
}>

async function loadPodcast(uuid: string): Promise<{ meta: PodcastMeta | null; status?: number; token?: string }> {
  const session = await getServerSession()
  const token = session?.tokens?.access_token
  try {
    const meta = await getPodcastMeta(`podcast_${uuid}`, { revalidate: 120, tags: ['podcasts'] }, token)
    return { meta, token }
  } catch (error: any) {
    return { meta: null, status: error?.status, token }
  }
}

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const { orgslug, podcastuuid } = await params
  const { uuid, resolved } = await resolveForPage(orgslug, 'podcast', podcastuuid, (k) => `/podcast/${k}`)
  const [ctx, { meta }] = await Promise.all([getSeoContext(orgslug), loadPodcast(uuid)])
  const podcast = meta?.podcast
  if (!podcast) return noindexMetadata(ctx.org?.name || 'Podcast')
  const key = podcast.slug || uuid
  return buildResourceMetadata({
    ctx,
    name: podcast.name,
    description: podcast.description || `Listen to this podcast from ${ctx.org?.name || 'this organization'}`,
    canonical: await ctx.url(`/podcast/${key}`),
    seo: podcast.seo,
    thumbnail: podcast.thumbnail_image
      ? getPodcastThumbnailMediaDirectory(ctx.org?.org_uuid, podcast.podcast_uuid, podcast.thumbnail_image)
      : undefined,
    generatedImage: await ctx.url(`/og/podcast/${key}`),
    ogType: 'music.playlist',
    indexable: !!podcast.public && !!podcast.published && !resolved?.restricted,
    keywords: podcast.tags || `${ctx.org?.name}, podcast, audio, learning`,
    modifiedTime: podcast.update_date,
  })
}

export default async function PodcastPage({ params }: { params: PageParams }) {
  const { orgslug, podcastuuid } = await params
  const { uuid } = await resolveForPage(orgslug, 'podcast', podcastuuid, (k) => `/podcast/${k}`)
  const [ctx, { meta, status, token }] = await Promise.all([getSeoContext(orgslug), loadPodcast(uuid)])

  // Missing, or denied-to-anon: 404 so non-public podcasts aren't enumerable.
  if (!meta && (status === undefined || status === 404 || !token)) {
    notFound()
  }

  if (!meta) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <p className="text-gray-500">You do not have permission to view this podcast.</p>
      </div>
    )
  }

  return (
    <PodcastClient
      orgslug={orgslug}
      org_id={ctx.org?.id || 0}
      podcastUuid={meta.podcast.podcast_uuid}
      initialPodcast={meta.podcast}
      initialEpisodes={meta.episodes}
    />
  )
}
