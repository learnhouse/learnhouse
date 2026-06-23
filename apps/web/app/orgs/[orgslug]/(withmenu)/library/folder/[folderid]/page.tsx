import React from 'react'
import { notFound } from 'next/navigation'
import FolderClient from './FolderClient'
import { Metadata } from 'next'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getFolderById } from '@services/folders/folders'
import { getOrgThumbnailMediaDirectory, getOrgOgImageMediaDirectory } from '@services/media/media'
import { getOrgSeoConfig, buildPageTitle } from '@/lib/seo/utils'
import { getServerCanonicalUrl } from '@/lib/seo/utils.server'
import { getServerSession } from '@/lib/auth/server'

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
    const folder = await getFolderById(
      `folder_${folderid}`,
      access_token ?? undefined,
      { revalidate: 0, tags: ['folders'] }
    )
    return folder && folder.folder_uuid ? folder : null
  } catch {
    return null
  }
}

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params
  const [org, folder] = await Promise.all([
    getOrganizationContextInfo(params.orgslug, { revalidate: 120, tags: ['organizations'] }),
    fetchFolderForViewer(params.folderid),
  ])

  const seoConfig = getOrgSeoConfig(org)

  // Private / inaccessible folder: never index, never leak the folder name.
  if (!folder) {
    return {
      title: buildPageTitle('Library', org.name, seoConfig),
      robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
    }
  }

  const ogImageUrl = seoConfig.default_og_image
    ? getOrgOgImageMediaDirectory(org?.org_uuid, seoConfig.default_og_image)
    : null
  const imageUrl = ogImageUrl || getOrgThumbnailMediaDirectory(org?.org_uuid, org?.thumbnail_image)
  const canonical = await getServerCanonicalUrl(params.orgslug, `/library/folder/${params.folderid}`)
  const title = buildPageTitle(folder.name || 'Library', org.name, seoConfig)
  const description = folder.description || org.description || seoConfig.default_meta_description || ''

  return {
    title,
    description,
    robots: {
      index: true,
      follow: true,
      nocache: true,
      googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
    },
    alternates: { canonical },
    openGraph: {
      title,
      description,
      type: 'website',
      images: [{ url: imageUrl, width: 800, height: 600, alt: org.name }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [imageUrl],
      ...(seoConfig.twitter_handle && { site: seoConfig.twitter_handle }),
    },
  }
}

const FolderPage = async (props: any) => {
  const params = await props.params
  // Server-side access gate: a private folder (or one the viewer lacks rights
  // to) returns a real 404 — no folder name/contents are rendered or indexed.
  const folder = await fetchFolderForViewer(params.folderid)
  if (!folder) {
    notFound()
  }
  return <FolderClient orgslug={params.orgslug} folderid={params.folderid} />
}

export default FolderPage
