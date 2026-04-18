import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getOrgThumbnailMediaDirectory, getOrgOgImageMediaDirectory } from '@services/media/media'
import { getCollectionById } from '@services/courses/collections'
import { getServerSession } from '@/lib/auth/server'
import { getCanonicalUrl, getOrgSeoConfig, buildPageTitle, buildBreadcrumbJsonLd } from '@/lib/seo/utils'
import { JsonLd } from '@components/SEO/JsonLd'
import CollectionClient from './collection'

type MetadataProps = {
  params: Promise<{ orgslug: string; collectionid: string }>
}

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token

  const org = await getOrganizationContextInfo(params.orgslug, {
    revalidate: 120,
    tags: ['organizations'],
  })

  const seoConfig = getOrgSeoConfig(org)

  let collection: any = null
  try {
    collection = await getCollectionById(
      `collection_${params.collectionid}`,
      access_token || '',
      { revalidate: 120, tags: ['collections'] }
    )
  } catch {
    // Collection might not exist or user doesn't have access
  }

  const title = buildPageTitle(collection ? collection.name : 'Collection', org?.name || 'Organization', seoConfig)
  const description = collection?.description || seoConfig.default_meta_description || `Browse this collection from ${org?.name || 'this organization'}`
  const ogImageUrl = seoConfig.default_og_image
    ? getOrgOgImageMediaDirectory(org?.org_uuid, seoConfig.default_og_image)
    : null
  const imageUrl = ogImageUrl || getOrgThumbnailMediaDirectory(org?.org_uuid, org?.thumbnail_image)
  const canonical = getCanonicalUrl(params.orgslug, `/collections/${params.collectionid}`)

  return {
    title,
    description,
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
      images: [
        {
          url: imageUrl,
          width: 800,
          height: 600,
          alt: collection?.name || org?.name || 'Collection',
        },
      ],
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

const CollectionPage = async (props: { params: MetadataProps['params'] }) => {
  const params = await props.params
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token

  let collection: any = null
  let fetchError: { status?: number } | null = null
  try {
    collection = await getCollectionById(
      `collection_${params.collectionid}`,
      access_token || '',
      { revalidate: 120, tags: ['collections'] }
    )
  } catch (error: any) {
    fetchError = { status: error?.status }
  }

  // Missing, or denied-to-anon: 404 so private collections can't be enumerated.
  if (!collection && (!fetchError || !access_token)) {
    notFound()
  }

  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: 'Home', url: getCanonicalUrl(params.orgslug, '/') },
    { name: 'Collections', url: getCanonicalUrl(params.orgslug, '/courses') },
    { name: collection?.name || 'Collection', url: getCanonicalUrl(params.orgslug, `/collection/${params.collectionid}`) },
  ])

  return (
    <>
      <JsonLd data={breadcrumbJsonLd} />
      <CollectionClient
        orgslug={params.orgslug}
        collectionid={params.collectionid}
      />
    </>
  )
}

export default CollectionPage
