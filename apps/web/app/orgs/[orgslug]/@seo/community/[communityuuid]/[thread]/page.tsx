import { SeoScripts } from '@components/SEO/SeoScripts'
import { getSeoContext } from '@/lib/seo/context.server'
import { fetchThreadJsonLd } from '@/lib/seo/publicData.server'
import { breadcrumbJsonLd, discussionJsonLd, qaPageJsonLd } from '@/lib/seo/jsonld'
import { THREAD_SEGMENT_RE } from '@/lib/seo/paths'
import { prosemirrorText } from '@/lib/seo/meta'

/**
 * A thread's structured data, from the anonymous view only (the API answers
 * for indexable threads and 404s for anything private, sold or thin): a
 * QAPage for answered questions, otherwise a DiscussionForumPosting with its
 * top replies. Never the signed-in visitor's view, so nothing private can
 * reach the HTML that crawlers and caches see.
 */
export default async function ThreadSeo({ params }: { params: Promise<{ orgslug: string; communityuuid: string; thread: string }> }) {
  const { orgslug, communityuuid, thread } = await params
  if (!THREAD_SEGMENT_RE.test(thread)) return null
  const [ctx, t] = await Promise.all([getSeoContext(orgslug), fetchThreadJsonLd(orgslug, decodeURIComponent(communityuuid), thread)])
  if (!t?.indexable || ctx.degraded || ctx.seo.indexing_disabled) return null
  const communityUrl = await ctx.url(`/community/${t.community_key}`)
  const url = await ctx.url(`/community/${t.community_key}/${t.segment}`)
  // Thread and reply bodies are editor JSON (or plain text): plain text here.
  const comments: any[] = (t.comments || []).map((c: any) => ({ ...c, content: prosemirrorText(c.content, 2000) }))
  const body = prosemirrorText(t.content, 5000)
  const main =
    t.label === 'question' && comments.length
      ? qaPageJsonLd({
          name: t.title,
          url,
          text: body,
          author: t.author,
          datePublished: t.published,
          upvotes: t.upvotes,
          answers: comments.map((c) => ({ text: c.content, author: c.author, datePublished: c.published, upvotes: c.upvotes, accepted: c.accepted })),
        })
      : discussionJsonLd({
          headline: t.title,
          url,
          text: body,
          author: { name: t.author },
          datePublished: t.published,
          dateModified: t.updated,
          upvotes: t.upvotes,
          commentCount: t.reply_count,
          comments: comments.map((c) => ({ text: c.content, author: c.author, datePublished: c.published, upvotes: c.upvotes })),
          communityName: t.community_name,
          communityUrl,
        })
  return (
    <SeoScripts
      items={[
        main,
        breadcrumbJsonLd([
          { name: ctx.org?.name || 'Home', url: ctx.base },
          { name: 'Communities', url: await ctx.url('/communities') },
          { name: t.community_name || t.community_key, url: communityUrl },
          { name: t.title, url },
        ]),
      ]}
    />
  )
}
