import { SeoScripts } from '@components/SEO/SeoScripts'
import { getPath } from '@services/paths/paths'
import { getPathThumbnailMediaDirectory } from '@services/media/media'
import { getSeoContext } from '@/lib/seo/context.server'
import { resolvePublicKey } from '@/lib/seo/resolve.server'
import { breadcrumbJsonLd, faqJsonLd, pathJsonLd } from '@/lib/seo/jsonld'
import { coursePath } from '@/lib/seo/paths'
import { seoImageUrl } from '@/lib/seo/meta'

export default async function PathSeo({ params }: { params: Promise<{ orgslug: string; pathuuid: string }> }) {
  const { orgslug, pathuuid } = await params
  const [ctx, resolved] = await Promise.all([getSeoContext(orgslug), resolvePublicKey(orgslug, 'path', pathuuid)])
  if (!resolved || resolved.restricted || ctx.seo.indexing_disabled) return null
  const path = await getPath(resolved.uuid, undefined).catch(() => null)
  if (!path?.public || !path?.published) return null
  const seo = path.seo || {}
  if (seo.enable_jsonld === false || seo.robots_noindex) return null
  const url = await ctx.url(`/path/${resolved.canonical_key}`)
  const courses = await Promise.all(
    (path.courses || [])
      .filter((c: any) => c.course?.name && !c.course?.restricted)
      .map(async (c: any) => ({ name: c.course.name, url: await ctx.url(coursePath(c.course)) })),
  )
  return (
    <SeoScripts
      items={[
        pathJsonLd({
          name: path.name,
          url,
          description: seo.description || path.description || path.about,
          image:
            seoImageUrl(ctx.org?.org_uuid, seo.og_image) ||
            (path.thumbnail_image ? getPathThumbnailMediaDirectory(ctx.org?.org_uuid, path.path_uuid, path.thumbnail_image) : undefined),
          org: ctx.orgRef,
          courses,
          educationalLevel: seo.educational_level || path.level,
          inLanguage: seo.in_language || ctx.lang,
        }),
        breadcrumbJsonLd([
          { name: ctx.org?.name || 'Home', url: ctx.base },
          { name: 'Paths', url: await ctx.url('/paths') },
          { name: path.name, url },
        ]),
        faqJsonLd(seo.faq || []),
      ]}
    />
  )
}
