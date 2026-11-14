import { SeoScripts } from '@components/SEO/SeoScripts'
import { getCommunity } from '@services/communities/communities'
import { getComments, getDiscussion } from '@services/communities/discussions'
import { getSeoContext } from '@/lib/seo/context.server'
import { resolvePublicKey } from '@/lib/seo/resolve.server'
import { breadcrumbJsonLd, discussionJsonLd } from '@/lib/seo/jsonld'
import { prosemirrorText } from '@/lib/seo/meta'

const authorName = (a: any) => [a?.first_name, a?.last_name].filter(Boolean).join(' ') || a?.username || 'Member'

/** A thread: DiscussionForumPosting with its replies (Google discussion forum). */
export default async function DiscussionSeo({
  params,
}: {
  params: Promise<{ orgslug: string; communityuuid: string; discussionuuid: string }>
}) {
  const { orgslug, communityuuid, discussionuuid } = await params
  const [ctx, resolved] = await Promise.all([getSeoContext(orgslug), resolvePublicKey(orgslug, 'community', communityuuid)])
  if (!resolved || resolved.restricted || ctx.seo.indexing_disabled || ctx.seo.noindex_communities) return null
  const [community, discussion, comments] = await Promise.all([
    getCommunity(resolved.uuid, null).catch(() => null),
    getDiscussion(`discussion_${discussionuuid}`, null).catch(() => null),
    getComments(`discussion_${discussionuuid}`, 1, 20, null).catch(() => []),
  ])
  if (!community?.public || !discussion?.title || community.seo?.robots_noindex) return null
  const communityUrl = await ctx.url(`/community/${resolved.canonical_key}`)
  const url = await ctx.url(`/community/${resolved.canonical_key}/discussion/${discussionuuid}`)
  return (
    <SeoScripts
      items={[
        discussionJsonLd({
          headline: discussion.title,
          url,
          text: prosemirrorText(discussion.content, 5000),
          author: { name: authorName((discussion as any).author) },
          datePublished: discussion.creation_date,
          dateModified: discussion.update_date,
          upvotes: discussion.upvote_count,
          commentCount: (comments || []).length,
          comments: (comments || []).map((c: any) => ({
            text: prosemirrorText(c.content, 2000),
            author: authorName(c.author),
            datePublished: c.creation_date,
            upvotes: c.upvote_count,
          })),
          communityName: community.name,
          communityUrl,
        }),
        breadcrumbJsonLd([
          { name: ctx.org?.name || 'Home', url: ctx.base },
          { name: 'Communities', url: await ctx.url('/communities') },
          { name: community.name, url: communityUrl },
          { name: discussion.title, url },
        ]),
      ]}
    />
  )
}
