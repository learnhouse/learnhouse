import { notFound, permanentRedirect } from 'next/navigation'
import { getServerSession } from '@/lib/auth/server'
import { lookupThread } from '@/lib/seo/publicData.server'
import ThreadView from '../../_thread/ThreadView'

/**
 * Old thread URL (`/community/{key}/discussion/{uuid}`): permanently
 * redirects to the readable one. Public threads already get a 301 from the
 * proxy; this covers signed-in visitors of private communities.
 */
export default async function LegacyDiscussionPage({ params }: { params: Promise<{ orgslug: string; communityuuid: string; discussionuuid: string }> }) {
  const { orgslug, communityuuid, discussionuuid } = await params
  const session = await getServerSession()
  const found = await lookupThread(orgslug, decodeURIComponent(communityuuid), discussionuuid, session?.tokens?.access_token ?? undefined)
  if (!found) notFound()
  if (found.locked) return <ThreadView orgslug={orgslug} communityUuid={found.community_uuid} discussionUuid={null} />
  permanentRedirect(`/community/${encodeURIComponent(found.community_key)}/${found.segment}`)
}

export const metadata = { robots: { index: false, follow: true } }
