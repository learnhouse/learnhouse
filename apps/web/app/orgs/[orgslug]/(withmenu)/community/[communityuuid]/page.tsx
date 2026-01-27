import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { Metadata } from 'next'
import { nextAuthOptions } from 'app/auth/options'
import { getServerSession } from 'next-auth'
import { getCommunity } from '@services/communities/communities'
import { getDiscussions, DiscussionWithAuthor } from '@services/communities/discussions'
import { getOrgThumbnailMediaDirectory } from '@services/media/media'
import CommunityClient from './community'

type MetadataProps = {
  params: Promise<{ orgslug: string; communityuuid: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params
  const org = await getOrganizationContextInfo(params.orgslug, {
    revalidate: 0,
    tags: ['organizations'],
  })

  const communityUuid = `community_${params.communityuuid}`
  let community = null
  try {
    community = await getCommunity(communityUuid, { revalidate: 0, tags: ['communities'] })
  } catch (error) {
    // Community might not exist or user doesn't have access
  }

  const title = community ? `${community.name} — ${org.name}` : `Community — ${org.name}`
  const description = community?.description || `Community discussions from ${org.name}`

  return {
    title,
    description,
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
      title,
      description,
      type: 'website',
      images: [
        {
          url: getOrgThumbnailMediaDirectory(org?.org_uuid, org?.thumbnail_image),
          width: 800,
          height: 600,
          alt: org.name,
        },
      ],
    },
  }
}

const CommunityPage = async (params: any) => {
  const session = await getServerSession(nextAuthOptions)
  const access_token = session?.tokens?.access_token
  const { orgslug, communityuuid } = await params.params
  const communityUuid = `community_${communityuuid}`

  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 1800,
    tags: ['organizations'],
  })
  const org_id = org.id

  let community = null
  let discussions: DiscussionWithAuthor[] = []

  try {
    community = await getCommunity(
      communityUuid,
      { revalidate: 0, tags: ['communities'] },
      access_token ? access_token : undefined
    )
  } catch (error) {
    console.error('Failed to fetch community:', error)
  }

  if (community) {
    try {
      discussions = await getDiscussions(
        communityUuid,
        'recent',
        1,
        10,
        { revalidate: 0, tags: ['discussions'] },
        access_token ? access_token : undefined
      )
    } catch (error) {
      console.error('Failed to fetch discussions:', error)
      discussions = []
    }
  }

  if (!community) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-600">Community not found</h1>
          <p className="text-gray-400 mt-2">This community doesn't exist or you don't have access</p>
        </div>
      </div>
    )
  }

  return (
    <CommunityClient
      community={community}
      initialDiscussions={discussions || []}
      orgslug={orgslug}
      org_id={org_id}
    />
  )
}

export default CommunityPage
