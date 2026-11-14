import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getServerSession } from '@/lib/auth/server'
import { getCommunity } from '@services/communities/communities'
import { getDiscussion } from '@services/communities/discussions'
import { getSeoContext } from '@/lib/seo/context.server'
import { resolveForPage } from '@/lib/seo/resolve.server'
import { buildResourceMetadata, noindexMetadata } from '@/lib/seo/pageMetadata'
import DiscussionPageClient from './discussion'
import ResourcePaywall from '@ee/components/Payments/ResourcePaywall'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'

/**
 * Extract plain text from discussion content for SEO metadata
 */
function getContentDescription(content: string | null): string {
  if (!content) return ''

  try {
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === 'object' && parsed.type === 'doc') {
      // Extract text from tiptap JSON
      const extractText = (node: any): string => {
        if (!node) return ''
        if (node.type === 'text') return node.text || ''
        if (node.content && Array.isArray(node.content)) {
          return node.content.map(extractText).join(' ')
        }
        return ''
      }
      return extractText(parsed).trim()
    }
  } catch {
    // Not JSON, return as-is
  }

  return content
}

type MetadataProps = {
  params: Promise<{ orgslug: string; communityuuid: string; discussionuuid: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params
  const { uuid: communityKey, resolved } = await resolveCommunity(params.orgslug, params.communityuuid, params.discussionuuid)
  const session = await getServerSession()
  const token = session?.tokens?.access_token
  const [ctx, community, discussion] = await Promise.all([
    getSeoContext(params.orgslug),
    getCommunity(`community_${communityKey}`, { revalidate: 120, tags: ['communities'] }, token).catch(() => null),
    // Discussion might not exist or user doesn't have access
    getDiscussion(`discussion_${params.discussionuuid}`, { revalidate: 120, tags: ['discussions'] }, token).catch(() => null),
  ])
  if (!discussion || !community) return noindexMetadata(`Discussion | ${ctx.org?.name || ''}`)

  const key = community.slug || communityKey
  const contentText = getContentDescription(discussion.content)
  return buildResourceMetadata({
    ctx,
    name: discussion.title,
    description: contentText || `Discussion in ${community.name} from ${ctx.org?.name}`,
    canonical: await ctx.url(`/community/${key}/discussion/${params.discussionuuid}`),
    seo: { robots_noindex: community.seo?.robots_noindex, robots_nofollow: community.seo?.robots_nofollow },
    generatedImage: await ctx.url(`/og/community/${key}`),
    ogType: 'article',
    indexable: !!community.public && !ctx.seo.noindex_communities && !resolved?.restricted,
    publishedTime: discussion.creation_date,
    modifiedTime: discussion.update_date,
  })
}

/** Community key → uuid; an old community slug redirects to the current one. */
async function resolveCommunity(orgslug: string, communityKey: string, discussionuuid: string) {
  return resolveForPage(orgslug, 'community', communityKey, (k) => `/community/${k}/discussion/${discussionuuid}`)
}

const DiscussionPage = async (params: any) => {
  const { orgslug, communityuuid, discussionuuid } = await params.params
  const { uuid: communityKey } = await resolveCommunity(orgslug, communityuuid, discussionuuid)
  const communityUuid = `community_${communityKey}`
  const discussionUuid = `discussion_${discussionuuid}`

  const [session, org] = await Promise.all([
    getServerSession(),
    getOrganizationContextInfo(orgslug, {
      revalidate: 120,
      tags: ['organizations'],
    }),
  ])
  const access_token = session?.tokens?.access_token

  let fetchErrored = false
  let discussionStatus: number | undefined

  // Independent lookups: fetch the community and the discussion together.
  const [community, discussion] = await Promise.all([
    getCommunity(
      communityUuid,
      { revalidate: 120, tags: ['communities'] },
      access_token ? access_token : undefined
    ).catch((error) => {
      fetchErrored = true
      console.error('Failed to fetch community:', error)
      return null
    }),
    getDiscussion(
      discussionUuid,
      { revalidate: 120, tags: ['discussions'] },
      access_token ? access_token : undefined
    ).catch((error: any) => {
      fetchErrored = true
      discussionStatus = error?.status
      console.error('Failed to fetch discussion:', error)
      return null
    }),
  ])

  // A sold community: show what unlocks it instead of a dead end.
  if (community && !discussion && discussionStatus === 402) {
    return (
      <GeneralWrapperStyled>
        <div className="max-w-2xl mx-auto pt-6">
          <ResourcePaywall orgId={org.id} orgslug={orgslug} resourceUuid={community.community_uuid} resourceName={community.name}>
            {null}
          </ResourcePaywall>
        </div>
      </GeneralWrapperStyled>
    )
  }

  // Missing or denied-to-anon: 404 so non-public discussions aren't enumerable.
  if ((!community || !discussion) && (!fetchErrored || !access_token)) {
    notFound()
  }

  if (!community || !discussion) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-600">You don't have access</h1>
          <p className="text-gray-400 mt-2">You do not have permission to view this discussion.</p>
        </div>
      </div>
    )
  }

  return (
    <DiscussionPageClient
      discussion={discussion}
      community={community}
      orgslug={orgslug}
    />
  )
}

export default DiscussionPage
