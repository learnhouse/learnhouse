import { Metadata } from 'next'
import { getSeoContext } from '@/lib/seo/context.server'
import { buildListMetadata } from '@/lib/seo/pageMetadata'
import { getOrgPodcasts } from '@services/podcasts/podcasts'
import { getOrgOr404 } from '@/lib/org.server'
import { getServerSession } from '@/lib/auth/server'
import PodcastsClient from './podcasts'

type PageParams = Promise<{
  orgslug: string
}>

export async function generateMetadata({ params }: { params: Promise<{ orgslug: string }> }): Promise<Metadata> {
  const { orgslug } = await params
  const ctx = await getSeoContext(orgslug)
  return buildListMetadata({ ctx, name: 'Podcasts', path: '/podcasts', description: ctx.org?.description || `Browse podcasts from ${ctx.org?.name || 'this organization'}`, keywords: undefined })
}

export default async function PodcastsPage({ params }: { params: PageParams }) {
  const { orgslug } = await params
  const [session, org] = await Promise.all([
    getServerSession(),
    getOrgOr404(orgslug),
  ])
  const access_token = session?.tokens?.access_token

  let initialPodcasts = []
  try {
    initialPodcasts = await getOrgPodcasts(
      orgslug,
      { revalidate: 120, tags: ['podcasts'] },
      access_token ? access_token : undefined,
      access_token ? true : false  // include_unpublished for logged-in users
    )
  } catch (error) {
    console.error('Error fetching podcasts:', error)
  }


  return (
    <>
      <PodcastsClient
        orgslug={orgslug}
        org_id={org?.id || 0}
        initialPodcasts={initialPodcasts || []}
      />
    </>
  )
}
