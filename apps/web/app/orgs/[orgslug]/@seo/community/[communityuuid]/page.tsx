import { SeoScripts } from '@components/SEO/SeoScripts'
import { getCommunity } from '@services/communities/communities'
import { getDiscussions } from '@services/communities/discussions'
import { getSeoContext } from '@/lib/seo/context.server'
import { resolvePublicKey } from '@/lib/seo/resolve.server'
import { breadcrumbJsonLd, communityJsonLd } from '@/lib/seo/jsonld'

export default async function CommunitySeo({ params }: { params: Promise<{ orgslug: string; communityuuid: string }> }) {
  const { orgslug, communityuuid } = await params
  const [ctx, resolved] = await Promise.all([getSeoContext(orgslug), resolvePublicKey(orgslug, 'community', communityuuid)])
  if (!resolved || resolved.restricted || ctx.seo.indexing_disabled || ctx.seo.noindex_communities) return null
  const [community, discussions] = await Promise.all([
    getCommunity(resolved.uuid, null).catch(() => null),
    getDiscussions(resolved.uuid, 'recent', 1, 20, null).catch(() => []),
  ])
  if (!community?.public) return null
  const seo = community.seo || {}
  if (seo.enable_jsonld === false || seo.robots_noindex) return null
  const url = await ctx.url(`/community/${resolved.canonical_key}`)
  const threads = await Promise.all(
    (discussions || []).map(async (d: any) => ({
      name: d.title,
      url: await ctx.url(`/community/${resolved.canonical_key}/discussion/${String(d.discussion_uuid).replace(/^discussion_/, '')}`),
    })),
  )
  return (
    <SeoScripts
      items={[
        communityJsonLd({ name: community.name, url, description: seo.description || community.description, org: ctx.orgRef, threads }),
        breadcrumbJsonLd([
          { name: ctx.org?.name || 'Home', url: ctx.base },
          { name: 'Communities', url: await ctx.url('/communities') },
          { name: community.name, url },
        ]),
      ]}
    />
  )
}
