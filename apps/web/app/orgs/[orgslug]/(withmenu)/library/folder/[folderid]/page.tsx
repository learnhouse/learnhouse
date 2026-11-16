import React from 'react'
import { notFound } from 'next/navigation'
import { Metadata } from 'next'
import FolderClient from './FolderClient'
import { getFolderById } from '@services/folders/folders'
import { getFolderThumbnailMediaDirectory } from '@services/media/media'
import { getServerSession } from '@/lib/auth/server'
import { getSeoContext } from '@/lib/seo/context.server'
import { resolveForPage } from '@/lib/seo/resolve.server'
import { buildResourceMetadata, noindexMetadata } from '@/lib/seo/pageMetadata'
import { buildPageTitle } from '@/lib/seo/utils'

type MetadataProps = {
  params: Promise<{ orgslug: string; folderid: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

/** Fetch the folder as the current viewer (forwards their session). Returns null
 * when the folder is private / the viewer has no access (the API denies). */
async function fetchFolderForViewer(folderid: string) {
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token
  try {
    const folder = await getFolderById(`folder_${folderid}`, access_token ?? undefined, { revalidate: 0, tags: ['folders'] })
    return folder && folder.folder_uuid ? folder : null
  } catch {
    return null
  }
}

function resolveFolder(orgslug: string, folderid: string) {
  return resolveForPage(orgslug, 'folder', folderid, (k) => `/library/folder/${k}`)
}

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params
  const { uuid } = await resolveFolder(params.orgslug, params.folderid)
  const [ctx, folder] = await Promise.all([getSeoContext(params.orgslug), fetchFolderForViewer(uuid)])

  // Private / inaccessible folder: never index, never leak the folder name.
  if (!folder) return noindexMetadata(buildPageTitle('Library', ctx.org?.name || '', ctx.seo))

  const key = folder.slug || uuid
  return buildResourceMetadata({
    ctx,
    name: folder.name || 'Library',
    description: folder.description || ctx.org?.description,
    canonical: await ctx.url(`/library/folder/${key}`),
    seo: folder.seo,
    thumbnail: folder.thumbnail_image
      ? getFolderThumbnailMediaDirectory(ctx.org?.org_uuid, folder.folder_uuid, folder.thumbnail_image)
      : undefined,
    generatedImage: await ctx.url(`/og/folder/${key}`),
    indexable: folder.public !== false,
    modifiedTime: folder.update_date,
  })
}

const FolderPage = async (props: MetadataProps) => {
  const params = await props.params
  const { uuid } = await resolveFolder(params.orgslug, params.folderid)
  // Server-side access gate: a private folder (or one the viewer lacks rights
  // to) returns a real 404; no folder name/contents are rendered or indexed.
  const folder = await fetchFolderForViewer(uuid)
  if (!folder) {
    notFound()
  }
  return <FolderClient orgslug={params.orgslug} folderid={uuid} />
}

export default FolderPage
