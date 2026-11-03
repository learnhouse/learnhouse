import { Metadata } from 'next'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getOrgThumbnailMediaDirectory, getOrgOgImageMediaDirectory } from '@services/media/media'
import { getOrgSeoConfig, buildPageTitle, buildBreadcrumbJsonLd } from '@/lib/seo/utils'
import { getServerCanonicalUrl } from '@/lib/seo/utils.server'
import { JsonLd } from '@components/SEO/JsonLd'
import PathsClient from './paths'

type PageParams = Promise<{ orgslug: string }>

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const { orgslug } = await params
  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 120,
    tags: ['organizations'],
  })
  const seoConfig = getOrgSeoConfig(org)
  const ogImageUrl = seoConfig.default_og_image
    ? getOrgOgImageMediaDirectory(org?.org_uuid, seoConfig.default_og_image)
    : null
  const imageUrl = ogImageUrl || (org ? getOrgThumbnailMediaDirectory(org.org_uuid, org.thumbnail_image) : undefined)
  const title = buildPageTitle('Paths', org?.name || 'Organization', seoConfig)
  const description =
    org?.description || seoConfig.default_meta_description || `Learning paths from ${org?.name || 'this organization'}`

  return {
    title,
    description,
    alternates: { canonical: await getServerCanonicalUrl(orgslug, '/paths') },
    openGraph: {
      title,
      description,
      type: 'website',
      ...(imageUrl && { images: [{ url: imageUrl, width: 800, height: 600, alt: org?.name || 'Paths' }] }),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(imageUrl && { images: [imageUrl] }),
      ...(seoConfig.twitter_handle && { site: seoConfig.twitter_handle }),
    },
  }
}

export default async function PathsPage({ params }: { params: PageParams }) {
  const { orgslug } = await params
  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 120,
    tags: ['organizations'],
  })
  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: 'Home', url: await getServerCanonicalUrl(orgslug, '/') },
    { name: 'Paths', url: await getServerCanonicalUrl(orgslug, '/paths') },
  ])

  return (
    <>
      <JsonLd data={breadcrumbJsonLd} />
      <PathsClient orgslug={orgslug} org_id={org?.id || 0} />
    </>
  )
}
