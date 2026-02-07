import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { Metadata } from 'next'
import { getServerSession } from '@/lib/auth/server'
import { getCommunity } from '@services/communities/communities'
import { getDiscussion } from '@services/communities/discussions'
import { getOrgThumbnailMediaDirectory } from '@services/media/media'
import DiscussionPageClient from './discussion'

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
  const org = await getOrganizationContextInfo(params.orgslug, {
    revalidate: 0,
    tags: ['organizations'],
  })

  const discussionUuid = `discussion_${params.discussionuuid}`
  let discussion = null
  try {
    discussion = await getDiscussion(discussionUuid, { revalidate: 0, tags: ['discussions'] })
  } catch (error) {
    // Discussion might not exist or user doesn't have access
  }

  const title = discussion ? `${discussion.title} — ${org.name}` : `Discussion — ${org.name}`
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
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token
  const { orgslug, communityuuid, discussionuuid } = await params.params
  const communityUuid = `community_${communityuuid}`
  const discussionUuid = `discussion_${discussionuuid}`

  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 1800,
    tags: ['organizations'],
  })

  let community = null
  let discussion = null

  try {
    community = await getCommunity(
      communityUuid,
      { revalidate: 0, tags: ['communities'] },
      access_token ? access_token : undefined
    )
  } catch (error) {
    console.error('Failed to fetch community:', error)
  }

  try {
    discussion = await getDiscussion(
      discussionUuid,
      { revalidate: 0, tags: ['discussions'] },
      access_token ? access_token : undefined
    )
  } catch (error) {
    console.error('Failed to fetch discussion:', error)
  }

  if (!community || !discussion) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-600">Discussion not found</h1>
          <p className="text-gray-400 mt-2">This discussion doesn't exist or you don't have access</p>
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
