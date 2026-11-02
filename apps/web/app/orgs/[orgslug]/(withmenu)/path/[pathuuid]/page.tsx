import { Metadata } from 'next'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getPath } from '@services/paths/paths'
import { getPathThumbnailMediaDirectory } from '@services/media/media'
import { getServerSession } from '@/lib/auth/server'
import { getOrgSeoConfig, buildPageTitle } from '@/lib/seo/utils'
import { getServerCanonicalUrl } from '@/lib/seo/utils.server'
import PathClient from './path'

type PageParams = Promise<{ orgslug: string; pathuuid: string }>

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const { orgslug, pathuuid } = await params
  const session = await getServerSession()
  const [org, path] = await Promise.all([
    getOrganizationContextInfo(orgslug, { revalidate: 120, tags: ['organizations'] }),
    getPath(`path_${pathuuid}`, session?.tokens?.access_token, { revalidate: 120, tags: ['paths'] }).catch(() => null),
  ])
  const seoConfig = getOrgSeoConfig(org)
  if (!path) {
    return { title: buildPageTitle('Path', org?.name || 'Organization', seoConfig), robots: { index: false } }
  }
  const title = buildPageTitle(path.name, org?.name || 'Organization', seoConfig)
  const description = path.description || `A learning path from ${org?.name}`
  const image = path.thumbnail_image
    ? getPathThumbnailMediaDirectory(org.org_uuid, path.path_uuid, path.thumbnail_image)
    : undefined

  return {
    title,
    description,
    robots: { index: path.public, follow: path.public },
    alternates: { canonical: await getServerCanonicalUrl(orgslug, `/path/${pathuuid}`) },
    openGraph: { title, description, type: 'website', ...(image && { images: [{ url: image, alt: path.name }] }) },
    twitter: { card: 'summary_large_image', title, description, ...(image && { images: [image] }) },
  }
}

export default async function PathPage({ params }: { params: PageParams }) {
  const { orgslug, pathuuid } = await params
  return <PathClient orgslug={orgslug} pathuuid={pathuuid} />
}
