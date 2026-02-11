import { Metadata } from 'next'
import { getPodcastMeta, PodcastMeta } from '@services/podcasts/podcasts'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getPodcastThumbnailMediaDirectory, getOrgOgImageMediaDirectory } from '@services/media/media'
import { getServerSession } from '@/lib/auth/server'
import { getCanonicalUrl, getOrgSeoConfig, buildPageTitle } from '@/lib/seo/utils'
import { JsonLd } from '@components/SEO/JsonLd'
import PodcastClient from './podcast'

type PageParams = Promise<{
  orgslug: string
  podcastuuid: string
}>

export async function generateMetadata({
  params,
}: {
  params: PageParams
}): Promise<Metadata> {
  const { orgslug, podcastuuid } = await params
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token

  let podcastMeta: PodcastMeta | null = null
  try {
    podcastMeta = await getPodcastMeta(
      `podcast_${podcastuuid}`,
      { revalidate: 0, tags: ['podcasts'] },
      access_token
    )
  } catch (error) {
    console.error('Error fetching podcast metadata:', error)
  }

  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 1800,
    tags: ['organizations'],
  })

  const seoConfig = getOrgSeoConfig(org)

  const title = buildPageTitle(podcastMeta?.podcast?.name || 'Podcast', org?.name || 'Organization', seoConfig)
  const description = podcastMeta?.podcast?.description || seoConfig.default_meta_description || `Listen to this podcast from ${org?.name || 'this organization'}`
  const ogImageUrl = seoConfig.default_og_image
    ? getOrgOgImageMediaDirectory(org?.org_uuid, seoConfig.default_og_image)
    : undefined
  const imageUrl = podcastMeta?.podcast?.thumbnail_image
    ? getPodcastThumbnailMediaDirectory(
        org?.org_uuid,
        `podcast_${podcastuuid}`,
        podcastMeta.podcast.thumbnail_image
      )
    : ogImageUrl
  const canonical = getCanonicalUrl(orgslug, `/podcast/${podcastuuid}`)

  return {
    title,
    description,
    keywords: podcastMeta?.podcast?.tags || `${org?.name}, podcast, audio, learning`,
    robots: {
      index: true,
      follow: true,
      nocache: true,
      googleBot: {
        index: true,
        follow: true,
        'max-image-preview': 'large',
      },
    },
    alternates: {
      canonical,
    },
    openGraph: {
      title,
      description,
      type: 'website',
      ...(imageUrl && {
        images: [
          {
            url: imageUrl,
            width: 800,
            height: 600,
            alt: podcastMeta?.podcast?.name || 'Podcast',
          },
        ],
      }),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(imageUrl && { images: [imageUrl] }),
      ...(seoConfig.twitter_handle && { site: seoConfig.twitter_handle }),
    },
  }
}

export default async function PodcastPage({ params }: { params: PageParams }) {
  const { orgslug, podcastuuid } = await params
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token

  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 1800,
    tags: ['organizations'],
  })

  let podcastMeta: PodcastMeta | null = null
  try {
    podcastMeta = await getPodcastMeta(
      `podcast_${podcastuuid}`,
      { revalidate: 0, tags: ['podcasts'] },
      access_token
    )
  } catch (error) {
    console.error('Error fetching podcast:', error)
  }

  if (!podcastMeta) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <p className="text-gray-500">Podcast not found</p>
      </div>
    )
  }

  const podcastJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'PodcastSeries',
    name: podcastMeta.podcast.name,
    description: podcastMeta.podcast.description,
    url: getCanonicalUrl(orgslug, `/podcast/${podcastuuid}`),
    provider: {
      '@type': 'Organization',
      name: org?.name,
    },
    episode: (podcastMeta.episodes || []).map((ep: any) => ({
      '@type': 'PodcastEpisode',
      name: ep.name,
      description: ep.description,
    })),
  }

  return (
    <>
      <JsonLd data={podcastJsonLd} />
      <PodcastClient
        orgslug={orgslug}
        org_id={org?.id || 0}
        podcastUuid={`podcast_${podcastuuid}`}
        initialPodcast={podcastMeta.podcast}
        initialEpisodes={podcastMeta.episodes}
      />
    </>
  )
}
