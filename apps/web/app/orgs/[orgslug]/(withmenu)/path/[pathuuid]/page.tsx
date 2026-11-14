import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPath } from '@services/paths/paths'
import { getPathThumbnailMediaDirectory } from '@services/media/media'
import { getServerSession } from '@/lib/auth/server'
import { getSeoContext } from '@/lib/seo/context.server'
import { resolveForPage } from '@/lib/seo/resolve.server'
import { buildResourceMetadata, noindexMetadata } from '@/lib/seo/pageMetadata'
import PathClient from './path'

type PageParams = Promise<{ orgslug: string; pathuuid: string }>

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const { orgslug, pathuuid } = await params
  const { uuid, resolved } = await resolveForPage(orgslug, 'path', pathuuid, (k) => `/path/${k}`)
  const session = await getServerSession()
  let status: number | undefined
  const [ctx, path] = await Promise.all([
    getSeoContext(orgslug),
    getPath(`path_${uuid}`, session?.tokens?.access_token, { revalidate: 120, tags: ['paths'] }).catch((e: any) => {
      status = e?.status
      return null
    }),
  ])
  if (!path) {
    if (!resolved && status === 404) notFound()
    return noindexMetadata(ctx.org?.name || 'Path')
  }
  const key = path.slug || uuid
  return buildResourceMetadata({
    ctx,
    name: path.name,
    description: path.description || path.about || `A learning path from ${ctx.org?.name}`,
    canonical: await ctx.url(`/path/${key}`),
    seo: path.seo,
    thumbnail: path.thumbnail_image ? getPathThumbnailMediaDirectory(ctx.org?.org_uuid, path.path_uuid, path.thumbnail_image) : undefined,
    generatedImage: await ctx.url(`/og/path/${key}`),
    indexable: !!path.public && !!path.published && !resolved?.restricted,
    modifiedTime: path.update_date,
  })
}

export default async function PathPage({ params }: { params: PageParams }) {
  const { orgslug, pathuuid } = await params
  const { uuid } = await resolveForPage(orgslug, 'path', pathuuid, (k) => `/path/${k}`)
  return <PathClient orgslug={orgslug} pathuuid={uuid} />
}
