import { Metadata } from 'next'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getOrgThumbnailMediaDirectory, getOrgOgImageMediaDirectory } from '@services/media/media'
import { getServerSession } from '@/lib/auth/server'
import { getCanonicalUrl, getOrgSeoConfig, buildPageTitle, buildBreadcrumbJsonLd } from '@/lib/seo/utils'
import { JsonLd } from '@components/SEO/JsonLd'
import { getBoards } from '@services/boards/boards'
import BoardsPublicClient from './boards'
import { redirect } from 'next/navigation'

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
    revalidate: 120,
    tags: ['organizations'],
  })

  const seoConfig = getOrgSeoConfig(org)

  const ogImageUrl = seoConfig.default_og_image
    ? getOrgOgImageMediaDirectory(org?.org_uuid, seoConfig.default_og_image)
    : null
  const imageUrl = ogImageUrl || (org ? getOrgThumbnailMediaDirectory(org.org_uuid, org.thumbnail_image) : undefined)
  const title = buildPageTitle('Boards', org?.name || 'Organization', seoConfig)
  const description = org?.description || seoConfig.default_meta_description || `Collaborative boards from ${org?.name || 'this organization'}`
  const canonical = getCanonicalUrl(orgslug, '/boards')

  return {
    title,
    description,
    keywords: `${org?.name}, boards, collaboration, projects, ${org?.name} boards`,
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
            alt: org?.name || 'Boards',
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

export default async function BoardsPage({ params }: { params: PageParams }) {
  const { orgslug } = await params
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token

  // Require authentication to view boards
  if (!access_token) {
    redirect(`/orgs/${orgslug}/login?redirect=/orgs/${orgslug}/boards`)
  }

  const org = await getOrganizationContextInfo(orgslug, {
    revalidate: 120,
    tags: ['organizations'],
  })

  let initialBoards: any[] = []
  try {
    if (access_token) {
      initialBoards = await getBoards(org?.id || 0, access_token)
    }
  } catch (error) {
    console.error('Error fetching boards:', error)
  }

  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: 'Home', url: getCanonicalUrl(orgslug, '/') },
    { name: 'Boards', url: getCanonicalUrl(orgslug, '/boards') },
  ])

  return (
    <>
      <JsonLd data={breadcrumbJsonLd} />
      <BoardsPublicClient
        orgslug={orgslug}
        org_id={org?.id || 0}
        initialBoards={initialBoards || []}
      />
    </>
  )
}
