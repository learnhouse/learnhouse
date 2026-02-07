import { Metadata } from 'next'
import { getOrgPodcasts } from '@services/podcasts/podcasts'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getOrgThumbnailMediaDirectory } from '@services/media/media'
import { getServerSession } from '@/lib/auth/server'
import PodcastsClient from './podcasts'

type PageParams = Promise<{
  orgslug: string
}>

export async function generateMetadata({
  params,
}: {
  params: PageParams
}): Promise<Metadata> {
  const { orgslug } = await params
  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 1800,
    tags: ['organizations'],
  })

  return {
    title: `Podcasts — ${org?.name || 'Organization'}`,
    description: org?.description || `Browse podcasts from ${org?.name || 'this organization'}`,
    keywords: `${org?.name}, podcasts, audio, learning, education, ${org?.name} podcasts`,
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
    openGraph: {
      title: `Podcasts — ${org?.name || 'Organization'}`,
      description: org?.description || `Browse podcasts from ${org?.name || 'this organization'}`,
      type: 'website',
      images: org ? [
        {
          url: getOrgThumbnailMediaDirectory(org.org_uuid, org.thumbnail_image),
          width: 800,
          height: 600,
          alt: org.name,
        },
      ] : [],
    },
  }
}

export default async function PodcastsPage({ params }: { params: PageParams }) {
  const { orgslug } = await params
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token

  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 1800,
    tags: ['organizations'],
  })

  let initialPodcasts = []
  try {
    initialPodcasts = await getOrgPodcasts(
      orgslug,
      { revalidate: 0, tags: ['podcasts'] },
      access_token ? access_token : undefined,
      access_token ? true : false  // include_unpublished for logged-in users
    )
  } catch (error) {
    console.error('Error fetching podcasts:', error)
  }

  return (
    <PodcastsClient
      orgslug={orgslug}
      org_id={org?.id || 0}
      initialPodcasts={initialPodcasts || []}
    />
  )
}
