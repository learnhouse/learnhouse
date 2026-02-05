import { Metadata } from 'next'
import { getPodcastMeta, PodcastMeta } from '@services/podcasts/podcasts'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getServerSession } from '@/lib/auth/server'
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

  return {
    title: podcastMeta?.podcast?.name
      ? `${podcastMeta.podcast.name} - ${org?.name || 'Organization'}`
      : 'Podcast',
    description: podcastMeta?.podcast?.description || `Listen to this podcast from ${org?.name || 'this organization'}`,
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

  return (
    <PodcastClient
      orgslug={orgslug}
      org_id={org?.id || 0}
      podcastUuid={`podcast_${podcastuuid}`}
      initialPodcast={podcastMeta.podcast}
      initialEpisodes={podcastMeta.episodes}
    />
  )
}
