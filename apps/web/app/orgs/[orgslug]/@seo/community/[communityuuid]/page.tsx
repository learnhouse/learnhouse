import { SeoScripts } from '@components/SEO/SeoScripts'
import { getCommunity } from '@services/communities/communities'
import { getDiscussions } from '@services/communities/discussions'
import { getSeoContext } from '@/lib/seo/context.server'
import { resolvePublicKey } from '@/lib/seo/resolve.server'
import { breadcrumbJsonLd, communityJsonLd } from '@/lib/seo/jsonld'
import { threadPath } from '@/lib/seo/paths'
import { canonicalQuery, communityFeedView } from '@/lib/seo/communityView'

const PAGE_SIZE = 20

/**
 * A community index (one page of one view): CollectionPage listing its
 * threads at their readable URLs, breadcrumbs, and rel=prev/next between
 * pages of the default order (Bing still uses them; React hoists the links
 * into <head>). Anonymous data only.
 */
export default async function CommunitySeo({
  params,
  searchParams,
}: {
  params: Promise<{ orgslug: string; communityuuid: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { orgslug, communityuuid } = await params
  const view = communityFeedView(await searchParams)
  const [ctx, resolved] = await Promise.all([getSeoContext(orgslug), resolvePublicKey(orgslug, 'community', communityuuid)])
  if (!resolved || resolved.restricted || ctx.degraded || ctx.seo.indexing_disabled || ctx.seo.noindex_communities) return null
  const [community, discussions] = await Promise.all([
    getCommunity(resolved.uuid, null).catch(() => null),
    getDiscussions(resolved.uuid, view.apiSort, view.page, PAGE_SIZE, null, undefined, view.label ?? undefined).catch(() => []),
  ])
  if (!community?.public) return null
  const seo = community.seo || {}
  if (seo.enable_jsonld === false || seo.robots_noindex) return null
  const key = resolved.canonical_key
  const base = await ctx.url(`/community/${key}`)
  const url = `${base}${canonicalQuery(view)}`
  const list = Array.isArray(discussions) ? discussions : []
  const threads = await Promise.all(
    list.map(async (d: any) => ({
      name: d.title,
      url: await ctx.url(d.id ? threadPath(key, d) : `/community/${key}/discussion/${String(d.discussion_uuid).replace(/^discussion_/, '')}`),
    })),
  )
  const paged = view.sort === 'latest'
  const prev = paged && view.page > 1 ? `${base}${canonicalQuery({ label: view.label, page: view.page - 1 })}` : null
  const next = paged && list.length >= PAGE_SIZE ? `${base}${canonicalQuery({ label: view.label, page: view.page + 1 })}` : null
  return (
    <>
      {prev ? <link rel="prev" href={prev} /> : null}
      {next ? <link rel="next" href={next} /> : null}
      <SeoScripts
        items={[
          communityJsonLd({ name: community.name, url, description: seo.description || community.description, org: ctx.orgRef, threads }),
          breadcrumbJsonLd([
            { name: ctx.org?.name || 'Home', url: ctx.base },
            { name: 'Communities', url: await ctx.url('/communities') },
            { name: community.name, url: base },
          ]),
        ]}
      />
    </>
  )
}
