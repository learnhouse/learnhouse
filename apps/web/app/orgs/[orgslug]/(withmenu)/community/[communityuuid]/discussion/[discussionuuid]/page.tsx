import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getServerSession } from '@/lib/auth/server'
import { getCommunity } from '@services/communities/communities'
import { getDiscussion } from '@services/communities/discussions'
import { getOrgThumbnailMediaDirectory } from '@services/media/media'
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
  const discussionUuid = `discussion_${params.discussionuuid}`
  const [org, discussion] = await Promise.all([
    getOrganizationContextInfo(params.orgslug, {
      revalidate: 120,
      tags: ['organizations'],
    }),
    // Discussion might not exist or user doesn't have access
    getDiscussion(discussionUuid, { revalidate: 120, tags: ['discussions'] }).catch(() => null),
  ])

  const title = discussion ? `${discussion.title} | ${org.name}` : `Discussion | ${org.name}`
  const contentText = discussion ? getContentDescription(discussion.content) : ''
  const description = contentText ? contentText.substring(0, 160) : `Discussion from ${org.name}`

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
      type: 'article',
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

const DiscussionPage = async (params: any) => {
  const { orgslug, communityuuid, discussionuuid } = await params.params
  const communityUuid = `community_${communityuuid}`
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
