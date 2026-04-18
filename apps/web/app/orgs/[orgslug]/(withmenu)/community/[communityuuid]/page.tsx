import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getServerSession } from '@/lib/auth/server'
import { getCommunity } from '@services/communities/communities'
import { getDiscussions, DiscussionWithAuthor } from '@services/communities/discussions'
import { getOrgThumbnailMediaDirectory, getOrgOgImageMediaDirectory } from '@services/media/media'
import { getCanonicalUrl, getOrgSeoConfig, buildPageTitle, buildBreadcrumbJsonLd } from '@/lib/seo/utils'
import { JsonLd } from '@components/SEO/JsonLd'
import CommunityClient from './community'

type MetadataProps = {
  params: Promise<{ orgslug: string; communityuuid: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params
  const org = await getOrganizationContextInfo(params.orgslug, {
    revalidate: 120,
    tags: ['organizations'],
  })

  const communityUuid = `community_${params.communityuuid}`
  let community = null
  try {
    community = await getCommunity(communityUuid, { revalidate: 120, tags: ['communities'] })
  } catch (error) {
    // Community might not exist or user doesn't have access
  }

  const seoConfig = getOrgSeoConfig(org)

  const title = buildPageTitle(community ? community.name : 'Community', org.name, seoConfig)
  const description = community?.description || seoConfig.default_meta_description || `Community discussions from ${org.name}`

  const ogImageUrl = seoConfig.default_og_image
    ? getOrgOgImageMediaDirectory(org?.org_uuid, seoConfig.default_og_image)
    : null
  const imageUrl = ogImageUrl || getOrgThumbnailMediaDirectory(org?.org_uuid, org?.thumbnail_image)
  const canonical = getCanonicalUrl(params.orgslug, `/community/${params.communityuuid}`)

  return {
    title,
    description,
    robots: {
      index: !seoConfig.noindex_communities,
      follow: true,
      nocache: true,
      googleBot: {
        index: !seoConfig.noindex_communities,
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
      images: [
        {
          url: imageUrl,
          width: 800,
          height: 600,
          alt: org.name,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [imageUrl],
      ...(seoConfig.twitter_handle && { site: seoConfig.twitter_handle }),
    },
  }
}

const CommunityPage = async (params: any) => {
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token
  const { orgslug, communityuuid } = await params.params
  const communityUuid = `community_${communityuuid}`

  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 120,
    tags: ['organizations'],
  })
  const org_id = org.id

  let community = null
  let communityError: { status?: number } | null = null
  let discussions: DiscussionWithAuthor[] = []

  try {
    community = await getCommunity(
      communityUuid,
      { revalidate: 120, tags: ['communities'] },
      access_token ? access_token : undefined
    )
  } catch (error: any) {
    communityError = { status: error?.status }
    console.error('Failed to fetch community:', error)
  }

  if (community) {
    try {
      discussions = await getDiscussions(
        communityUuid,
        'recent',
        1,
        10,
        { revalidate: 120, tags: ['discussions'] },
        access_token ? access_token : undefined
      )
    } catch (error) {
      console.error('Failed to fetch discussions:', error)
      discussions = []
    }
  }

  // Missing, or denied-to-anon: 404 so non-public communities aren't enumerable.
  if (!community && (!communityError || !access_token)) {
    notFound()
  }

  if (!community) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-600">You don't have access</h1>
          <p className="text-gray-400 mt-2">You do not have permission to view this community.</p>
        </div>
      </div>
    )
  }

  const communityJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'DiscussionForumPosting',
    headline: community.name,
    description: community.description,
    author: {
      '@type': 'Organization',
      name: org.name,
    },
    url: getCanonicalUrl(orgslug, `/community/${communityuuid}`),
  }

  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: 'Home', url: getCanonicalUrl(orgslug, '/') },
    { name: 'Communities', url: getCanonicalUrl(orgslug, '/communities') },
    { name: community.name || 'Community', url: getCanonicalUrl(orgslug, `/community/${communityuuid}`) },
  ])

  return (
    <>
      <JsonLd data={breadcrumbJsonLd} />
      <JsonLd data={communityJsonLd} />
      <CommunityClient
        community={community}
        initialDiscussions={discussions || []}
        orgslug={orgslug}
        org_id={org_id}
      />
    </>
  )
}

export default CommunityPage
