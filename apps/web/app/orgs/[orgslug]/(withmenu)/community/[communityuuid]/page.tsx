import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getServerSession } from '@/lib/auth/server'
import { getCommunity } from '@services/communities/communities'
import { getDiscussions, DiscussionWithAuthor } from '@services/communities/discussions'
import { getCommunityThumbnailMediaDirectory } from '@services/media/media'
import { getSeoContext } from '@/lib/seo/context.server'
import { resolveForPage } from '@/lib/seo/resolve.server'
import { buildResourceMetadata, noindexMetadata } from '@/lib/seo/pageMetadata'
import CommunityClient from './community'

type MetadataProps = {
  params: Promise<{ orgslug: string; communityuuid: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params
  const { uuid, resolved } = await resolveForPage(params.orgslug, 'community', params.communityuuid, (k) => `/community/${k}`)
  const session = await getServerSession()
  const [ctx, community] = await Promise.all([
    getSeoContext(params.orgslug),
    getCommunity(`community_${uuid}`, { revalidate: 120, tags: ['communities'] }, session?.tokens?.access_token).catch(() => null),
  ])
  if (!community) return noindexMetadata(ctx.org?.name || 'Community')
  const key = community.slug || uuid
  return buildResourceMetadata({
    ctx,
    name: community.name,
    description: community.description || `Community discussions from ${ctx.org?.name}`,
    canonical: await ctx.url(`/community/${key}`),
    seo: community.seo,
    thumbnail: community.thumbnail_image
      ? getCommunityThumbnailMediaDirectory(ctx.org?.org_uuid, community.community_uuid, community.thumbnail_image)
      : undefined,
    generatedImage: await ctx.url(`/og/community/${key}`),
    indexable: !!community.public && !ctx.seo.noindex_communities && !resolved?.restricted,
    modifiedTime: community.update_date,
  })
}

const CommunityPage = async (props: MetadataProps) => {
  const { orgslug, communityuuid } = await props.params
  const { uuid } = await resolveForPage(orgslug, 'community', communityuuid, (k) => `/community/${k}`)
  const communityUuid = `community_${uuid}`

  const [session, ctx] = await Promise.all([getServerSession(), getSeoContext(orgslug)])
  const access_token = session?.tokens?.access_token
  const org_id = ctx.org.id

  let communityError: { status?: number } | null = null
  let discussionsError: unknown = null

  // The discussions only need the uuid and token, so fetch them alongside the
  // community instead of after it; they're only used if the community loads.
  const [community, fetchedDiscussions] = await Promise.all([
    getCommunity(communityUuid, { revalidate: 120, tags: ['communities'] }, access_token ? access_token : undefined).catch(
      (error: any) => {
        communityError = { status: error?.status }
        console.error('Failed to fetch community:', error)
        return null
      },
    ),
    getDiscussions(communityUuid, 'recent', 1, 10, { revalidate: 120, tags: ['discussions'] }, access_token ? access_token : undefined).catch(
      (error) => {
        discussionsError = error
        return [] as DiscussionWithAuthor[]
      },
    ),
  ])

  let discussions: DiscussionWithAuthor[] = []
  if (community) {
    if (discussionsError) {
      console.error('Failed to fetch discussions:', discussionsError)
    }
    discussions = fetchedDiscussions
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

  return <CommunityClient community={community} initialDiscussions={discussions || []} orgslug={orgslug} org_id={org_id} />
}

export default CommunityPage
