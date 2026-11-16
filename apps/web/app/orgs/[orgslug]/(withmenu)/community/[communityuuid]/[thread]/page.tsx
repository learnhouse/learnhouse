import { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { getServerSession } from '@/lib/auth/server'
import { getCommunity } from '@services/communities/communities'
import { getDiscussion } from '@services/communities/discussions'
import { getSeoContext } from '@/lib/seo/context.server'
import { lookupThread } from '@/lib/seo/publicData.server'
import { buildResourceMetadata, noindexMetadata } from '@/lib/seo/pageMetadata'
import { THREAD_SEGMENT_RE } from '@/lib/seo/paths'
import { feedsEnabled, llmsEnabled, prosemirrorText } from '@/lib/seo/meta'
import ThreadView from '../_thread/ThreadView'

type Params = Promise<{ orgslug: string; communityuuid: string; thread: string }>

/**
 * A community thread at its readable URL: `/community/{key}/{id}-{slug}`.
 * The numeric id is what counts: a renamed thread, an old community slug or
 * a community uuid all redirect permanently to the current URL.
 */
async function resolve(orgslug: string, communityKey: string, thread: string) {
  if (!THREAD_SEGMENT_RE.test(thread)) notFound()
  const session = await getServerSession()
  const token = session?.tokens?.access_token ?? undefined
  const found = await lookupThread(orgslug, decodeURIComponent(communityKey), thread, token)
  if (!found) notFound()
  return { found, token }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { orgslug, communityuuid, thread } = await params
  const { found, token } = await resolve(orgslug, communityuuid, thread)
  const ctx = await getSeoContext(orgslug)
  if (found.locked) return noindexMetadata(ctx.org?.name || 'Community')
  const [community, discussion] = await Promise.all([
    getCommunity(found.community_uuid, { revalidate: 120, tags: ['communities'] }, token).catch(() => null),
    getDiscussion(found.discussion_uuid, { revalidate: 120, tags: ['discussions'] }, token).catch(() => null),
  ])
  if (!community || !discussion) return noindexMetadata(ctx.org?.name || 'Community')
  const path = `/community/${found.community_key}/${found.segment}`
  const canonical = await ctx.url(path)
  const text = prosemirrorText(discussion.content, 600)
  const meta = buildResourceMetadata({
    ctx,
    name: discussion.title,
    description: text || `${found.reply_count} replies in ${community.name}, a ${ctx.org?.name} community.`,
    canonical,
    seo: { robots_noindex: community.seo?.robots_noindex, robots_nofollow: community.seo?.robots_nofollow },
    generatedImage: found.indexable ? await ctx.url(`/og/thread/${found.community_key}~${found.segment}`) : await ctx.url(`/og/community/${found.community_key}`),
    ogType: 'article',
    indexable: found.indexable,
    publishedTime: discussion.creation_date,
    modifiedTime: discussion.update_date,
    tags: [community.name],
  })
  const types: Record<string, string> = {}
  if (found.indexable && llmsEnabled(ctx.seo)) types['text/markdown'] = await ctx.url(`${path}.md`)
  if (found.indexable && feedsEnabled(ctx.seo)) types['application/rss+xml'] = await ctx.url(`/community/${found.community_key}/feed.xml`)
  return Object.keys(types).length ? { ...meta, alternates: { ...(meta.alternates || {}), types } } : meta
}

export default async function ThreadPage({ params }: { params: Params }) {
  const { orgslug, communityuuid, thread } = await params
  const { found } = await resolve(orgslug, communityuuid, thread)
  if (found.locked) {
    return <ThreadView orgslug={orgslug} communityUuid={found.community_uuid} discussionUuid={null} />
  }
  if (decodeURIComponent(communityuuid) !== found.community_key || thread !== found.segment) {
    permanentRedirect(`/community/${encodeURIComponent(found.community_key)}/${found.segment}`)
  }
  return <ThreadView orgslug={orgslug} communityUuid={found.community_uuid} discussionUuid={found.discussion_uuid} />
}
