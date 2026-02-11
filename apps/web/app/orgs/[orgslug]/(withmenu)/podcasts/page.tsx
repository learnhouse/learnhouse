import { Metadata } from 'next'
import { getOrgPodcasts } from '@services/podcasts/podcasts'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getOrgThumbnailMediaDirectory, getOrgOgImageMediaDirectory } from '@services/media/media'
import { getServerSession } from '@/lib/auth/server'
import { getCanonicalUrl, getOrgSeoConfig, buildPageTitle, buildBreadcrumbJsonLd } from '@/lib/seo/utils'
import { JsonLd } from '@components/SEO/JsonLd'
import PodcastsClient from './podcasts'

type PageParams = Promise<{
  orgslug: string
}>

export async function generateMetadata({
  params,
}: {
  params: PageParams
}): Promise<Metadata> {
  const { orgslug } = await params
  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 1800,
    tags: ['organizations'],
  })

  const seoConfig = getOrgSeoConfig(org)

  const ogImageUrl = seoConfig.default_og_image
    ? getOrgOgImageMediaDirectory(org?.org_uuid, seoConfig.default_og_image)
    : null
  const imageUrl = ogImageUrl || (org ? getOrgThumbnailMediaDirectory(org.org_uuid, org.thumbnail_image) : undefined)
  const title = buildPageTitle('Podcasts', org?.name || 'Organization', seoConfig)
  const description = org?.description || seoConfig.default_meta_description || `Browse podcasts from ${org?.name || 'this organization'}`
  const canonical = getCanonicalUrl(orgslug, '/podcasts')

  return {
    title,
    description,
    keywords: `${org?.name}, podcasts, audio, learning, education, ${org?.name} podcasts`,
    robots: {
      index: true,
      follow: true,
      nocache: true,
      googleBot: {
        index: true,
        follow: true,
        'max-image-preview': 'large',
      },
    },
    alternates: {
      canonical,
    },
    openGraph: {
      title,
      description,
      type: 'website',
      ...(imageUrl && {
        images: [
          {
            url: imageUrl,
            width: 800,
            height: 600,
            alt: org?.name || 'Podcasts',
          },
        ],
      }),
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

export default async function PodcastsPage({ params }: { params: PageParams }) {
  const { orgslug } = await params
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token

  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 1800,
    tags: ['organizations'],
  })

  let initialPodcasts = []
  try {
    initialPodcasts = await getOrgPodcasts(
      orgslug,
      { revalidate: 0, tags: ['podcasts'] },
      access_token ? access_token : undefined,
      access_token ? true : false  // include_unpublished for logged-in users
    )
  } catch (error) {
    console.error('Error fetching podcasts:', error)
  }

  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: 'Home', url: getCanonicalUrl(orgslug, '/') },
    { name: 'Podcasts', url: getCanonicalUrl(orgslug, '/podcasts') },
  ])

  return (
    <>
      <JsonLd data={breadcrumbJsonLd} />
      <PodcastsClient
        orgslug={orgslug}
        org_id={org?.id || 0}
        initialPodcasts={initialPodcasts || []}
      />
    </>
  )
}
