import { notFound } from 'next/navigation'
import NoAccessNotice from '@components/Objects/StyledElements/Error/NoAccessNotice'
import { getServerSession } from '@/lib/auth/server'
import { getOrgOr404 } from '@/lib/org.server'
import { getCommunity } from '@services/communities/communities'
import { getDiscussion } from '@services/communities/discussions'
import ResourcePaywall from '@ee/components/Payments/ResourcePaywall'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import DiscussionPageClient from '../discussion/[discussionuuid]/discussion'

/**
 * A thread page body: the same client view the uuid URL rendered, shared by
 * the readable `/community/{key}/{id}-{slug}` route. Data reads use the
 * visitor's own token, so access works exactly as before.
 */
export default async function ThreadView({
  orgslug,
  communityUuid,
  discussionUuid,
}: {
  orgslug: string
  communityUuid: string
  /** Full uuid (`discussion_...`), or null when only the community is known (paywalled). */
  discussionUuid: string | null
}) {
  const [session, org] = await Promise.all([
    getServerSession(),
    getOrgOr404(orgslug),
  ])
  const access_token = session?.tokens?.access_token

  let fetchErrored = false
  let discussionStatus: number | undefined = discussionUuid ? undefined : 402

  const [community, discussion] = await Promise.all([
    getCommunity(communityUuid, { revalidate: 120, tags: ['communities'] }, access_token ? access_token : undefined).catch((error) => {
      fetchErrored = true
      console.error('Failed to fetch community:', error)
      return null
    }),
    discussionUuid
      ? getDiscussion(discussionUuid, { revalidate: 120, tags: ['discussions'] }, access_token ? access_token : undefined).catch((error: any) => {
          fetchErrored = true
          discussionStatus = error?.status
          console.error('Failed to fetch discussion:', error)
          return null
        })
      : Promise.resolve(null),
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
      <NoAccessNotice kind="discussion" />
    )
  }

  return <DiscussionPageClient discussion={discussion} community={community} orgslug={orgslug} />
}
