import { SeoScripts } from '@components/SEO/SeoScripts'
import { getFolderById } from '@services/folders/folders'
import { getFolderThumbnailMediaDirectory } from '@services/media/media'
import { getSeoContext } from '@/lib/seo/context.server'
import { resolvePublicKey } from '@/lib/seo/resolve.server'
import { breadcrumbJsonLd, collectionJsonLd } from '@/lib/seo/jsonld'
import { resourcePath, type SeoResourceType } from '@/lib/seo/paths'

const ITEM_TYPES: Record<string, SeoResourceType> = { courses: 'course', podcasts: 'podcast', communities: 'community' }

export default async function FolderSeo({ params }: { params: Promise<{ orgslug: string; folderid: string }> }) {
  const { orgslug, folderid } = await params
  const [ctx, resolved] = await Promise.all([getSeoContext(orgslug), resolvePublicKey(orgslug, 'folder', folderid)])
  if (!resolved || resolved.restricted || ctx.seo.indexing_disabled) return null
  const folder = await getFolderById(resolved.uuid, undefined, null).catch(() => null)
  if (!folder?.folder_uuid || folder.public === false || folder.seo?.robots_noindex) return null
  const url = await ctx.url(`/library/folder/${resolved.canonical_key}`)
  const items = await Promise.all(
    (folder.items || [])
      .filter((i: any) => ITEM_TYPES[i.resource_type] && i.resource?.name)
      .map(async (i: any) => ({ name: i.resource.name, url: await ctx.url(resourcePath(ITEM_TYPES[i.resource_type], i.resource)) })),
  )
  const crumbs = await Promise.all(
    (folder.breadcrumbs || []).slice(0, -1).map(async (b: any) => ({
      name: b.name,
      url: await ctx.url(`/library/folder/${String(b.folder_uuid).replace(/^folder_/, '')}`),
    })),
  )
  return (
    <SeoScripts
      items={[
        collectionJsonLd({
          name: folder.name,
          url,
          description: folder.seo?.description || folder.description,
          image: folder.thumbnail_image ? getFolderThumbnailMediaDirectory(ctx.org?.org_uuid, folder.folder_uuid, folder.thumbnail_image) : undefined,
          org: ctx.orgRef,
          items,
        }),
        breadcrumbJsonLd([
          { name: ctx.org?.name || 'Home', url: ctx.base },
          { name: 'Library', url: await ctx.url('/library') },
          ...crumbs,
          { name: folder.name, url },
        ]),
      ]}
    />
  )
}
